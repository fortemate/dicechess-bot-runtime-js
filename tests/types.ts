import {
  createWebhookHandler,
  type WebhookHandlerOptions,
  type BotStrategy,
  type DecisionControl,
  type DrawDecisionContext,
  type MoveTree,
  type TurnContext,
} from "@fortemate/dicechess-bot-runtime";
import { createNodeListener } from "@fortemate/dicechess-bot-runtime/node";
declare const options: WebhookHandlerOptions;
const handler: (request: Request) => Promise<Response> =
  createWebhookHandler(options);
const _listener = createNodeListener(handler);

const tree: MoveTree = { e2e4: { g1f3: {} } };
const turn: TurnContext = {
  gameId: "synthetic-game",
  seat: "White",
  version: 7,
  dfen: "synthetic-position",
  clock: null,
  legalMoves: tree,
  mayOfferDraw: false,
};
const control: DecisionControl = {
  signal: new AbortController().signal,
  deadlineEpochMs: 1000,
};
const asyncStrategy: BotStrategy = {
  async onTurn(context, request) {
    await Promise.resolve();
    request.signal.throwIfAborted();
    if (context.legalMoves === null)
      throw new Error("Fixture moves unavailable");
    return { moves: ["e2e4", "g1f3"] };
  },
  onDrawDecision() {
    return { acceptDraw: false };
  },
};
const syncStrategy: BotStrategy = { onTurn: () => ({ moves: ["e2e4"] }) };
const _asyncPromise = asyncStrategy.onTurn(turn, control);
const _syncResult = syncStrategy.onTurn(turn, control);
const unavailable: TurnContext = { ...turn, legalMoves: null };
// @ts-expect-error Contexts cannot mutate a delivered tree.
tree.e2e4 = {};
// @ts-expect-error The seat is not a free-form string.
const invalidSeat: TurnContext = { ...turn, seat: "white" };
declare const draw: DrawDecisionContext;
// @ts-expect-error Pre-roll draw contexts expose no legal moves.
const _drawLegalMoves = draw.legalMoves;
const invalidDraw: BotStrategy = {
  onTurn: () => ({ moves: [] }),
  // @ts-expect-error Draw actions must say whether they accept.
  onDrawDecision: () => ({}),
};

export {
  _listener,
  _asyncPromise,
  _syncResult,
  unavailable,
  invalidSeat,
  _drawLegalMoves,
  invalidDraw,
};
