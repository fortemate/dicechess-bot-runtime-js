import {
  ACTIVATION_PROOF_PREFIX,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "./protocol.js";
import type {
  BotStrategy,
  DecisionContext,
  GameClock,
  MoveTree,
  Seat,
  TurnContext,
} from "./protocol.js";
import {
  Failure,
  framed,
  hex,
  integer,
  invalid,
  json,
  key,
  nonblank,
  readBytes,
  record,
  tree,
  uci,
} from "./boundary.js";

export interface RuntimeLimits {
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly maxTreeNodes: number;
  readonly maxTreeDepth: number;
  readonly maxConcurrentRequests: number;
  readonly maxCacheEntries: number;
  readonly cacheTtlMs: number;
}
export interface WebhookHandlerOptions {
  readonly keys: { readonly active?: string; readonly pending?: string };
  readonly strategy: BotStrategy;
  readonly limits: RuntimeLimits;
  readonly now?: () => number;
  readonly allowLegacyReadiness?: boolean;
  readonly playApiBaseUrl?: string;
  readonly fetch?: typeof fetch;
}
interface Result {
  status: number;
  body: string;
}
interface Entry {
  fingerprint: string;
  result: Promise<Result>;
  settled: boolean;
  expires: number;
}
function ok(body: unknown): Result {
  return { status: 200, body: JSON.stringify(body) };
}
function failure(error: unknown): Result {
  const f =
    error instanceof Failure ? error : new Failure("strategy_failed", 500);
  return { status: f.status, body: JSON.stringify({ error: f.code }) };
}
function response(result: Result): Response {
  return new Response(result.body, {
    status: result.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
function actionRecord(value: unknown): Record<string, unknown> {
  try {
    return record(value);
  } catch {
    throw new Failure("strategy_failed", 500);
  }
}
function clock(state: Record<string, unknown>, seat: Seat): GameClock | null {
  if (state.clocks == null) return null;
  const clocks = record(state.clocks);
  const white = integer(clocks.white),
    black = integer(clocks.black);
  let incrementMillis: number | null = null;
  try {
    const increment =
      integer(record(record(state.timeControl).Fischer).incrementSeconds) *
      1000;
    if (Number.isSafeInteger(increment)) incrementMillis = increment;
  } catch {
    /* Optional capability fails closed. */
  }
  return Object.freeze({
    remainingMillis: seat === "White" ? white : black,
    opponentRemainingMillis: seat === "White" ? black : white,
    incrementMillis,
  });
}

/** Creates process-local handling state. Does not listen, register, or publish. */
export function createWebhookHandler(
  options: WebhookHandlerOptions,
): (request: Request) => Promise<Response> {
  const limits = { ...options.limits };
  for (const name of [
    "timeoutMs",
    "maxBodyBytes",
    "maxTreeNodes",
    "maxTreeDepth",
    "maxConcurrentRequests",
    "maxCacheEntries",
    "cacheTtlMs",
  ] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0)
      throw new TypeError("Positive integer runtime limits are required");
  }
  if (limits.timeoutMs > 2147483647 || limits.maxTreeDepth > 256)
    throw new TypeError("Runtime limit exceeds supported range");
  const secrets = { ...options.keys };
  if (!secrets.active && !secrets.pending)
    throw new TypeError("At least one webhook key is required");
  for (const secret of Object.values(secrets))
    if (secret !== undefined && (typeof secret !== "string" || !secret.trim()))
      throw new TypeError("Invalid webhook key");
  if (typeof options.strategy.onTurn !== "function")
    throw new TypeError("onTurn is required");
  const onTurn = options.strategy.onTurn.bind(options.strategy);
  const onDraw = options.strategy.onDrawDecision?.bind(options.strategy);
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const readiness = options.allowLegacyReadiness === true;
  let base: string | undefined;
  if (options.playApiBaseUrl !== undefined) {
    const url = new URL(options.playApiBaseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new TypeError("Invalid play API base URL");
    base = url.href.replace(/\/$/, "");
  }
  const cache = new Map<string, Entry>();
  let active = 0;
  return async (request) => {
    if (active >= limits.maxConcurrentRequests)
      return response(failure(new Failure("capacity_exceeded", 503)));
    active++;
    const controller = new AbortController();
    const start = performance.now();
    const receivedEpochMs = now();
    let budgetMs = limits.timeoutMs;
    const timeout = () =>
      controller.abort(new Failure("deadline_exceeded", 504));
    const check = () => {
      if (performance.now() - start >= budgetMs) timeout();
      controller.signal.throwIfAborted();
    };
    let timer = setTimeout(timeout, budgetMs);
    request.signal.addEventListener("abort", timeout, { once: true });
    if (request.signal.aborted) timeout();
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<Result>((resolve) => {
      abortListener = () => resolve(failure(controller.signal.reason));
      controller.signal.addEventListener("abort", abortListener, {
        once: true,
      });
      if (controller.signal.aborted) abortListener();
    });
    let control = Object.freeze({
      signal: controller.signal,
      deadlineEpochMs: receivedEpochMs + budgetMs,
    });
    const safe = async (work: () => Promise<Result>): Promise<Result> => {
      try {
        check();
        const result = await work();
        check();
        return result;
      } catch (error) {
        return failure(
          controller.signal.aborted ? controller.signal.reason : error,
        );
      }
    };
    async function dispatch(
      envelope: Record<string, unknown>,
      context: DecisionContext,
      state: Record<string, unknown>,
    ): Promise<Result> {
      if (envelope.type === "drawDecision") {
        const action = actionRecord(
          onDraw
            ? await onDraw(Object.freeze(context), control)
            : { acceptDraw: false },
        );
        check();
        if (
          typeof action.acceptDraw !== "boolean" ||
          (action.resign !== undefined && typeof action.resign !== "boolean")
        )
          throw new Failure("strategy_failed", 500);
        return ok({
          acceptDraw: action.resign === true ? false : action.acceptDraw,
          ...(action.resign === true ? { resign: true } : {}),
        });
      }
      let legal: MoveTree;
      if (state.legalMoves == null) {
        if (!base) throw new Failure("missing_legal_moves", 503);
        try {
          const fetched = await fetcher(
            `${base}/games/${encodeURIComponent(context.gameId)}/moves`,
            { signal: controller.signal, redirect: "error" },
          );
          try {
            check();
          } catch (error) {
            void fetched.body?.cancel().catch(() => {});
            throw error;
          }
          if (fetched.status !== 200) {
            void fetched.body?.cancel().catch(() => {});
            throw new Failure("missing_legal_moves", 503);
          }
          const payload = json(
            await readBytes(
              fetched.body,
              limits.maxBodyBytes,
              controller.signal,
            ),
          );
          check();
          if (
            integer(payload.version) !== context.version ||
            payload.dfen !== context.dfen ||
            payload.dicePending !== true
          )
            throw new Failure("stale_context", 409);
          legal = tree(
            payload.legalMoves,
            limits.maxTreeNodes,
            limits.maxTreeDepth,
          );
        } catch (error) {
          check();
          if (error instanceof Failure && error.code === "stale_context")
            throw error;
          throw new Failure("missing_legal_moves", 503);
        }
      } else
        legal = tree(
          state.legalMoves,
          limits.maxTreeNodes,
          limits.maxTreeDepth,
        );
      check();
      if (Object.keys(legal).length === 0)
        return ok({ moves: [], offerDraw: false });
      const turn: TurnContext = Object.freeze({
        ...context,
        legalMoves: legal,
        mayOfferDraw: state.mayOfferDraw === true,
      });
      const action = actionRecord(await onTurn(turn, control));
      check();
      const bad = () => {
        throw new Failure("strategy_failed", 500);
      };
      if (
        !Array.isArray(action.moves) ||
        (action.offerDraw !== undefined &&
          typeof action.offerDraw !== "boolean") ||
        (action.resign !== undefined && typeof action.resign !== "boolean")
      )
        bad();
      if (action.resign === true) return ok({ moves: [], resign: true });
      const moves = action.moves as unknown[];
      if (
        !moves.length ||
        moves.length > limits.maxTreeDepth ||
        (action.offerDraw === true && !turn.mayOfferDraw)
      )
        bad();
      let cursor = legal;
      for (const move of moves) {
        if (
          typeof move !== "string" ||
          !uci.test(move) ||
          !Object.hasOwn(cursor, move)
        )
          bad();
        cursor = cursor[move as string]!;
      }
      if (Object.keys(cursor).length) bad();
      return ok({
        moves: [...moves],
        ...(action.offerDraw !== undefined
          ? { offerDraw: action.offerDraw }
          : {}),
      });
    }
    const work = safe(async () => {
      if (request.method !== "POST") throw new Failure("invalid_request", 405);
      const body = await readBytes(
        request.body,
        limits.maxBodyBytes,
        controller.signal,
      );
      check();
      const stamp = request.headers.get(TIMESTAMP_HEADER) ?? "";
      const signature = request.headers.get(SIGNATURE_HEADER) ?? "";
      if (
        !/^(0|[1-9]\d*)$/.test(stamp) ||
        !Number.isSafeInteger(Number(stamp)) ||
        !/^[0-9a-f]{64}$/.test(signature) ||
        Math.abs(Math.floor(now() / 1000) - Number(stamp)) > 300
      )
        throw new Failure("unauthorized", 401);
      const bytes = Uint8Array.from(signature.match(/../g)!, (byte) =>
        parseInt(byte, 16),
      );
      const data = framed(stamp + ".", body);
      const [activeMatch, pendingMatch] = await Promise.all(
        [secrets.active, secrets.pending].map(
          async (secret) =>
            secret !== undefined &&
            (await crypto.subtle.verify(
              "HMAC",
              await key(secret),
              bytes,
              data,
            )),
        ),
      );
      check();
      if (!activeMatch && !pendingMatch) throw new Failure("unauthorized", 401);
      const envelope = json(body);
      if (envelope.type === "verification") {
        if (!Object.hasOwn(envelope, "version") && readiness)
          return ok({ nonce: nonblank(envelope.nonce) });
        if (envelope.version !== 2)
          throw new Failure("unsupported_delivery", 400);
        if (!pendingMatch || secrets.pending === undefined)
          throw new Failure("unauthorized", 401);
        const bot = record(envelope.bot);
        nonblank(bot.team);
        nonblank(bot.name);
        nonblank(envelope.setupId);
        nonblank(envelope.revision);
        const nonce = nonblank(envelope.nonce);
        if (!/^[A-Za-z0-9_-]+$/.test(nonce)) invalid();
        let decoded: string;
        try {
          decoded = atob(nonce.replace(/-/g, "+").replace(/_/g, "/"));
        } catch {
          return invalid();
        }
        if (
          decoded.length < 16 ||
          btoa(decoded)
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_") !== nonce
        )
          invalid();
        const proof = hex(
          await crypto.subtle.sign(
            "HMAC",
            await key(secrets.pending),
            framed(ACTIVATION_PROOF_PREFIX, body),
          ),
        );
        return ok({ nonce, proof });
      }
      if (envelope.type !== "yourTurn" && envelope.type !== "drawDecision")
        throw new Failure("unsupported_delivery", 400);
      const gameId = nonblank(envelope.gameId);
      if (gameId === "." || gameId === "..") invalid();
      const seat = envelope.seat;
      if (seat !== "White" && seat !== "Black") invalid();
      const state = record(envelope.state);
      if (
        state.activeSeat !== seat ||
        state.dicePending !== (envelope.type === "yourTurn")
      )
        invalid();
      const context: DecisionContext = {
        gameId,
        seat,
        version: integer(state.version),
        dfen: nonblank(state.dfen),
        clock: clock(state, seat),
      };
      if (
        envelope.type === "drawDecision" &&
        (record(state.drawOffer).pending !== true ||
          context.dfen.trim().split(/\s+/).length !== 6)
      )
        invalid();
      if (context.clock) {
        budgetMs = Math.min(budgetMs, context.clock.remainingMillis);
        clearTimeout(timer);
        check();
        timer = setTimeout(
          timeout,
          Math.max(0, budgetMs - (performance.now() - start)),
        );
        control = Object.freeze({
          signal: controller.signal,
          deadlineEpochMs: receivedEpochMs + budgetMs,
        });
      }
      const id = JSON.stringify([gameId, seat, context.version, envelope.type]);
      // Clocks tick between same-version retries. Compare decision inputs, not
      // the raw transport snapshot. Sort legal edges for stable JSON ordering.
      const normalizeTree = (value: MoveTree): unknown =>
        Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((move) => [move, normalizeTree(value[move]!)]),
        );
      const legalIdentity =
        envelope.type === "yourTurn" && state.legalMoves != null
          ? normalizeTree(
              tree(state.legalMoves, limits.maxTreeNodes, limits.maxTreeDepth),
            )
          : null;
      const fingerprint = JSON.stringify([
        context.dfen,
        context.clock?.incrementMillis ?? null,
        envelope.type === "yourTurn" && state.mayOfferDraw === true,
        legalIdentity,
      ]);
      check();
      for (const [name, entry] of cache)
        if (entry.settled && performance.now() >= entry.expires)
          cache.delete(name);
      const existing = cache.get(id);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Failure("stale_context", 409);
        return existing.result;
      }
      if (cache.size >= limits.maxCacheEntries)
        throw new Failure("capacity_exceeded", 503);
      // Keep the slot until actual work settles, even when a callback ignores abort.
      const task = safe(() => dispatch(envelope, context, state));
      const entry: Entry = {
        fingerprint,
        result: Promise.race([task, aborted]),
        settled: false,
        expires: Infinity,
      };
      cache.set(id, entry);
      void task.then((result) => {
        entry.settled = true;
        entry.expires = performance.now() + limits.cacheTtlMs;
        if (result.status !== 200) cache.delete(id);
      });
      return entry.result;
    });
    try {
      return response(await Promise.race([work, aborted]));
    } finally {
      active--;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", timeout);
      if (abortListener)
        controller.signal.removeEventListener("abort", abortListener);
    }
  };
}
