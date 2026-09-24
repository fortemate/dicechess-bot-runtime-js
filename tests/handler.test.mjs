import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import fixtures from "../fixtures/contexts.json" with { type: "json" };
import { createWebhookHandler } from "../dist/index.js";

const secret = "synthetic-runtime-test-key";
const timestamp = 1756728000;
const limits = {
  timeoutMs: 1000,
  maxBodyBytes: 65536,
  maxTreeNodes: 100,
  maxTreeDepth: 8,
  maxConcurrentRequests: 16,
  maxCacheEntries: 32,
  cacheTtlMs: 1000,
};
const clone = (value = fixtures[0].envelope) => structuredClone(value);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function request(envelope = clone(), signal) {
  const body =
    typeof envelope === "string" ? envelope : JSON.stringify(envelope);
  return new Request("https://bot.invalid/webhook", {
    method: "POST",
    body,
    signal,
    headers: {
      "x-dicechess-timestamp": String(timestamp),
      "x-dicechess-signature": createHmac("sha256", secret)
        .update(timestamp + ".")
        .update(body)
        .digest("hex"),
    },
  });
}
function app(overrides = {}) {
  return createWebhookHandler({
    keys: { active: secret },
    limits,
    now: () => timestamp * 1000,
    strategy: { onTurn: () => ({ moves: ["e2e3"] }) },
    ...overrides,
  });
}
async function error(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: code });
}

for (const fixture of fixtures.filter(
  (f) =>
    (f.context.legalMoves && Object.keys(f.context.legalMoves).length) ||
    f.envelope.type === "drawDecision",
)) {
  test(`real handler normalizes immutable ${fixture.id} context`, async () => {
    let seen;
    const capture = (context, control) => {
      seen = context;
      assert.equal(
        control.deadlineEpochMs,
        timestamp * 1000 + limits.timeoutMs,
      );
      assert.equal(control.signal.aborted, false);
      assert.ok(Object.isFrozen(context));
      if (context.clock) assert.ok(Object.isFrozen(context.clock));
      if (context.legalMoves) assert.ok(Object.isFrozen(context.legalMoves));
    };
    const handler = app({
      strategy: {
        async onTurn(ctx, control) {
          capture(ctx, control);
          return { moves: [Object.keys(ctx.legalMoves)[0]] };
        },
        async onDrawDecision(ctx, control) {
          capture(ctx, control);
          return { acceptDraw: true };
        },
      },
    });
    assert.equal((await handler(request(fixture.envelope))).status, 200);
    assert.deepEqual(seen, fixture.context);
  });
}
test("empty root acknowledges server auto-pass without strategy", async () => {
  const handler = app({
    strategy: {
      onTurn() {
        assert.fail("must not dispatch");
      },
    },
  });
  assert.deepEqual(
    await (await handler(request(fixtures[5].envelope))).json(),
    { moves: [], offerDraw: false },
  );
});
test("absent draw callback declines explicitly", async () => {
  assert.deepEqual(await (await app()(request(fixtures[6].envelope))).json(), {
    acceptDraw: false,
  });
});
for (const value of [null, undefined])
  test(`missing tree ${value} is not pass`, async () => {
    const envelope = clone();
    envelope.state.legalMoves = value;
    await error(await app()(request(envelope)), 503, "missing_legal_moves");
  });
for (const [name, change] of [
  [
    "wrong seat",
    (e) => {
      e.seat = "Black";
    },
  ],
  [
    "wrong phase",
    (e) => {
      e.state.dicePending = false;
    },
  ],
  [
    "unsafe version",
    (e) => {
      e.state.version = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "negative version",
    (e) => {
      e.state.version = -1;
    },
  ],
  [
    "bad clocks",
    (e) => {
      e.state.clocks = { white: -1, black: 2 };
    },
  ],
  [
    "array tree",
    (e) => {
      e.state.legalMoves = [];
    },
  ],
  [
    "wrapped tree",
    (e) => {
      e.state.legalMoves = { children: {} };
    },
  ],
  [
    "null child",
    (e) => {
      e.state.legalMoves = { e2e3: null };
    },
  ],
  [
    "path traversal",
    (e) => {
      e.gameId = "..";
    },
  ],
])
  test(`invalid envelope: ${name}`, async () => {
    const envelope = clone();
    change(envelope);
    await error(
      await app({
        strategy: {
          onTurn() {
            assert.fail("must not dispatch");
          },
        },
      })(request(envelope)),
      400,
      "invalid_request",
    );
  });
test("fractional literal rounded by JSON.parse cannot impersonate an integer", async () => {
  const body = JSON.stringify(clone()).replace(
    '"version":7',
    '"version":7.00000000000000001',
  );
  await error(await app()(request(body)), 400, "invalid_request");
});
test("optional malformed increment fails closed", async () => {
  const envelope = clone(fixtures[1].envelope);
  envelope.state.timeControl.Fischer.incrementSeconds = Number.MAX_SAFE_INTEGER;
  const handler = app({
    strategy: {
      onTurn(ctx) {
        assert.equal(ctx.clock.incrementMillis, null);
        return { moves: ["e2e3"] };
      },
    },
  });
  assert.equal((await handler(request(envelope))).status, 200);
});
for (const moves of [[], ["e2e4"], ["e2e3"], ["e2e3", "e3e4", "e4e5"]])
  test(`reject non-leaf path ${JSON.stringify(moves)}`, async () => {
    const envelope = clone();
    envelope.state.legalMoves = { e2e3: { e3e4: {} } };
    await error(
      await app({ strategy: { onTurn: () => ({ moves }) } })(request(envelope)),
      500,
      "strategy_failed",
    );
  });
test("complete server path is preserved, not pruned", async () => {
  const envelope = clone();
  envelope.state.legalMoves = { e2e3: { e3e4: {} }, e2e4: {} };
  const handler = app({
    strategy: {
      onTurn(ctx) {
        assert.deepEqual(ctx.legalMoves, envelope.state.legalMoves);
        return { moves: ["e2e3", "e3e4"], ignored: "not serialized" };
      },
    },
  });
  assert.deepEqual(await (await handler(request(envelope))).json(), {
    moves: ["e2e3", "e3e4"],
  });
});
for (const action of [
  null,
  {},
  { moves: ["e2e3"], offerDraw: true },
  { moves: ["e2e3"], resign: "yes" },
])
  test(`reject invalid strategy output ${JSON.stringify(action)}`, async () => {
    await error(
      await app({ strategy: { onTurn: () => action } })(request()),
      500,
      "strategy_failed",
    );
  });
test("explicit resignation only, never manufactured on exceptions", async () => {
  assert.deepEqual(
    await (
      await app({ strategy: { onTurn: () => ({ moves: [], resign: true }) } })(
        request(),
      )
    ).json(),
    { moves: [], resign: true },
  );
  const handler = app({
    strategy: {
      onTurn() {
        throw new Error("sensitive diagnostic");
      },
    },
  });
  await error(await handler(request()), 500, "strategy_failed");
});
for (const changed of [
  { version: 8 },
  { dfen: "another snapshot" },
  { dicePending: false },
])
  test(`fallback rejects mismatch ${JSON.stringify(changed)}`, async () => {
    const envelope = clone();
    envelope.state.legalMoves = null;
    const handler = app({
      playApiBaseUrl: "https://api.invalid",
      fetch: async () =>
        Response.json({
          ...envelope.state,
          legalMoves: { e2e3: {} },
          ...changed,
        }),
    });
    await error(await handler(request(envelope)), 409, "stale_context");
  });
test("fallback binds original snapshot and sends no incoming credentials", async () => {
  const envelope = clone();
  delete envelope.state.legalMoves;
  const handler = app({
    playApiBaseUrl: "https://api.invalid/api/",
    fetch: async (url, init) => {
      assert.equal(url, "https://api.invalid/api/games/synthetic-game/moves");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers, undefined);
      assert.ok(init.signal);
      return Response.json({ ...envelope.state, legalMoves: { e2e3: {} } });
    },
  });
  assert.equal((await handler(request(envelope))).status, 200);
});
for (const response of [
  () => new Response("failure", { status: 500 }),
  () => new Response("not json"),
  () => new Response("x".repeat(65537)),
])
  test("failed or oversized fallback is unavailable, never pass", async () => {
    const envelope = clone();
    envelope.state.legalMoves = null;
    await error(
      await app({
        playApiBaseUrl: "https://api.invalid",
        fetch: async () => response(),
      })(request(envelope)),
      503,
      "missing_legal_moves",
    );
  });
test("tree node and depth budgets are enforced", async () => {
  const envelope = clone();
  envelope.state.legalMoves = { e2e3: { e3e4: {} } };
  for (const change of [{ maxTreeNodes: 2 }, { maxTreeDepth: 1 }])
    await error(
      await app({ limits: { ...limits, ...change } })(request(envelope)),
      400,
      "invalid_request",
    );
});
test("duplicate requests share work and cached success; conflicting body rejected", async () => {
  const gate = deferred();
  const entered = deferred();
  let calls = 0;
  const handler = app({
    strategy: {
      async onTurn() {
        calls++;
        entered.resolve();
        await gate.promise;
        return { moves: ["e2e3"] };
      },
    },
  });
  const first = handler(request());
  await entered.promise;
  const second = handler(request());
  const conflict = clone();
  conflict.state.dfen += " ";
  await error(await handler(request(conflict)), 409, "stale_context");
  gate.resolve();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls, 1);
});
test("failed callbacks may retry after settling", async () => {
  let calls = 0;
  const handler = app({
    strategy: {
      onTurn() {
        if (++calls === 1) throw new Error("synthetic");
        return { moves: ["e2e3"] };
      },
    },
  });
  await error(await handler(request()), 500, "strategy_failed");
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls, 2);
});
test("deadline discards late result and retains uncooperative work slot", async () => {
  const gate = deferred();
  let signal;
  let calls = 0;
  const handler = app({
    limits: { ...limits, timeoutMs: 30, maxCacheEntries: 1 },
    strategy: {
      async onTurn(_ctx, ctl) {
        calls++;
        signal = ctl.signal;
        await gate.promise;
        return { moves: ["e2e3"] };
      },
    },
  });
  await error(await handler(request()), 504, "deadline_exceeded");
  assert.equal(signal.aborted, true);
  await error(await handler(request()), 504, "deadline_exceeded");
  assert.equal(calls, 1);
  const next = clone();
  next.state.version++;
  await error(await handler(request(next)), 503, "capacity_exceeded");
  gate.resolve();
  await delay(0);
  assert.equal((await handler(request(next))).status, 200);
});
test("cancelled duplicate does not cancel original work", async () => {
  const gate = deferred();
  const entered = deferred();
  let signal;
  const handler = app({
    strategy: {
      async onTurn(_ctx, ctl) {
        signal = ctl.signal;
        entered.resolve();
        await gate.promise;
        return { moves: ["e2e3"] };
      },
    },
  });
  const first = handler(request());
  await entered.promise;
  const abort = new AbortController();
  const duplicate = handler(request(clone(), abort.signal));
  abort.abort();
  await error(await duplicate, 504, "deadline_exceeded");
  assert.equal(signal.aborted, false);
  gate.resolve();
  assert.equal((await first).status, 200);
});
test("owner cancellation prevents successful late result", async () => {
  const gate = deferred();
  const entered = deferred();
  const abort = new AbortController();
  const handler = app({
    strategy: {
      async onTurn() {
        entered.resolve();
        await gate.promise;
        return { moves: ["e2e3"] };
      },
    },
  });
  const result = handler(request(clone(), abort.signal));
  await entered.promise;
  abort.abort();
  await error(await result, 504, "deadline_exceeded");
  gate.resolve();
  await delay(0);
});
test("request admission is bounded before reading a body", async () => {
  const gate = deferred();
  const entered = deferred();
  const handler = app({
    limits: { ...limits, maxConcurrentRequests: 1 },
    strategy: {
      async onTurn() {
        entered.resolve();
        await gate.promise;
        return { moves: ["e2e3"] };
      },
    },
  });
  const first = handler(request());
  await entered.promise;
  await error(await handler(request()), 503, "capacity_exceeded");
  gate.resolve();
  await first;
});
test("completed cache entries expire and capacity becomes available", async () => {
  let calls = 0;
  const handler = app({
    limits: { ...limits, cacheTtlMs: 15, maxCacheEntries: 1 },
    strategy: {
      onTurn() {
        calls++;
        return { moves: ["e2e3"] };
      },
    },
  });
  assert.equal((await handler(request())).status, 200);
  await delay(25);
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls, 2);
});
test("fallback shares delivery deadline, even when fetch ignores abort", async () => {
  const gate = deferred();
  let signal;
  let calls = 0;
  const envelope = clone();
  envelope.state.legalMoves = null;
  const handler = app({
    limits: { ...limits, timeoutMs: 30 },
    playApiBaseUrl: "https://api.invalid",
    fetch: async (_url, init) => {
      signal = init.signal;
      await gate.promise;
      return Response.json({ ...envelope.state, legalMoves: { e2e3: {} } });
    },
    strategy: {
      onTurn() {
        calls++;
        return { moves: ["e2e3"] };
      },
    },
  });
  await error(await handler(request(envelope)), 504, "deadline_exceeded");
  assert.equal(signal.aborted, true);
  gate.resolve();
  await delay(0);
  assert.equal(calls, 0);
});
test("configuration requires explicit finite bounds and keys", () => {
  for (const change of [
    { timeoutMs: 0 },
    { maxTreeDepth: 257 },
    { maxBodyBytes: Infinity },
  ])
    assert.throws(() => app({ limits: { ...limits, ...change } }), TypeError);
  assert.throws(() => app({ keys: {} }), TypeError);
  assert.throws(
    () => app({ playApiBaseUrl: "https://synthetic-user@api.invalid" }),
    TypeError,
  );
});
test("same-version retry with ticking clocks reuses pending and completed work", async () => {
  const gate = deferred();
  const entered = deferred();
  let calls = 0;
  const envelope = clone(fixtures[1].envelope);
  const handler = app({
    strategy: {
      async onTurn() {
        calls++;
        entered.resolve();
        await gate.promise;
        return { moves: ["e2e3"] };
      },
    },
  });
  const first = handler(request(envelope));
  await entered.promise;
  envelope.state.clocks.white--;
  const second = handler(request(envelope));
  gate.resolve();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  envelope.state.clocks.white--;
  assert.equal((await handler(request(envelope))).status, 200);
  assert.equal(calls, 1);
});
test("tree property ordering does not create a false conflict", async () => {
  let calls = 0;
  const envelope = clone();
  envelope.state.legalMoves = { e2e3: {}, e2e4: {} };
  const handler = app({
    strategy: {
      onTurn() {
        calls++;
        return { moves: ["e2e3"] };
      },
    },
  });
  assert.equal((await handler(request(envelope))).status, 200);
  envelope.state.legalMoves = { e2e4: {}, e2e3: {} };
  assert.equal((await handler(request(envelope))).status, 200);
  assert.equal(calls, 1);
});
test("remaining own clock clamps strategy deadline", async () => {
  const gate = deferred();
  const envelope = clone(fixtures[1].envelope);
  envelope.state.clocks.white = 30;
  let seen;
  const handler = app({
    strategy: {
      async onTurn(_ctx, control) {
        seen = control;
        await gate.promise;
        return { moves: ["e2e3"] };
      },
    },
  });
  await error(await handler(request(envelope)), 504, "deadline_exceeded");
  assert.equal(seen.deadlineEpochMs, timestamp * 1000 + 30);
  assert.equal(seen.signal.aborted, true);
  gate.resolve();
  await delay(0);
});
test("zero clock cannot dispatch", async () => {
  const envelope = clone(fixtures[1].envelope);
  envelope.state.clocks.white = 0;
  await error(
    await app({
      strategy: {
        onTurn() {
          assert.fail("expired dispatch");
        },
      },
    })(request(envelope)),
    504,
    "deadline_exceeded",
  );
});
test("malformed draw results are strategy failures", async () => {
  for (const action of [null, [], "yes", {}, { acceptDraw: "true" }])
    await error(
      await app({
        strategy: {
          onTurn() {
            assert.fail("wrong callback");
          },
          onDrawDecision: () => action,
        },
      })(request(fixtures[6].envelope)),
      500,
      "strategy_failed",
    );
});
test("body streaming deadline cancels the reader", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request("https://bot.invalid", {
    method: "POST",
    body,
    duplex: "half",
  });
  await error(
    await app({ limits: { ...limits, timeoutMs: 20 } })(req),
    504,
    "deadline_exceeded",
  );
  assert.equal(cancelled, true);
  await delay(0);
});
test("invalid UTF-8 is rejected after authenticating original bytes", async () => {
  const body = new Uint8Array([0xff]);
  const req = new Request("https://bot.invalid", {
    method: "POST",
    body,
    headers: {
      "x-dicechess-timestamp": String(timestamp),
      "x-dicechess-signature": createHmac("sha256", secret)
        .update(timestamp + ".")
        .update(body)
        .digest("hex"),
    },
  });
  await error(await app()(req), 400, "invalid_request");
});
