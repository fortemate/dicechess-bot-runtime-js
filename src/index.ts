/**
 * Protocol foundation only. No webhook handler or authentication is implemented.
 * These types describe validated data; they do not validate network JSON.
 */
export const SIGNATURE_HEADER = "x-dicechess-signature";
export const TIMESTAMP_HEADER = "x-dicechess-timestamp";
export const VERIFICATION_VERSION = 2;
export const ACTIVATION_PROOF_PREFIX = "dicechess-webhook-activate-v2\n";

/** Gameplay events emitted by the pinned server; not a runtime support claim. */
export const CONTRACT_DELIVERY_TYPES = Object.freeze([
  "yourTurn",
  "drawDecision",
] as const);

export const PROTOCOL_REFERENCES = Object.freeze({
  serverCommit: "e0d9ff54e462126b8d5f0bc2d270938587a60d3c",
  jvmCommit: "798196d564657d3f7b6eb5be4e5227b92ebb9266",
});

export type Seat = "White" | "Black";

/** A root {} means no legal turn. A non-root {} terminates a complete path. */
export interface MoveTree {
  readonly [uci: string]: MoveTree;
}

/** Minimal consumed wire fields, not the full public game snapshot. */
export interface WireState {
  readonly version: number;
  readonly dfen: string;
  readonly activeSeat: Seat;
  readonly clocks?: { readonly white: number; readonly black: number } | null;
  readonly timeControl?: unknown;
}

export interface TurnEnvelope {
  readonly type: "yourTurn";
  readonly gameId: string;
  readonly seat: Seat;
  readonly state: WireState & {
    readonly dicePending: true;
    readonly legalMoves?: MoveTree | null;
    readonly mayOfferDraw?: unknown;
  };
}

export interface DrawDecisionEnvelope {
  readonly type: "drawDecision";
  readonly gameId: string;
  readonly seat: Seat;
  readonly state: WireState & {
    readonly dicePending: false;
    readonly drawOffer: { readonly pending: true };
  };
}

export type GameplayEnvelope = TurnEnvelope | DrawDecisionEnvelope;

export interface VerificationV2 {
  readonly type: "verification";
  readonly version: 2;
  readonly bot: { readonly team: string; readonly name: string };
  readonly setupId: string;
  readonly revision: string;
  readonly nonce: string;
}

export interface VerificationProof {
  readonly nonce: string;
  readonly proof: string;
}

export interface GameMovesResponse {
  readonly version: number;
  readonly dfen: string;
  readonly dicePending: boolean;
  readonly legalMoves: MoveTree;
}

/** Milliseconds from the bot's perspective; null increment means no increment. */
export interface GameClock {
  readonly remainingMillis: number;
  readonly opponentRemainingMillis: number;
  readonly incrementMillis: number | null;
}

/** Validated base fields. Version must be an exactly representable safe integer. */
export interface DecisionContext {
  readonly gameId: string;
  readonly seat: Seat;
  readonly version: number;
  readonly dfen: string;
  readonly clock: GameClock | null;
}

export interface TurnContext extends DecisionContext {
  /** null means unavailable, not forced pass; {} means no legal turn. */
  readonly legalMoves: MoveTree | null;
  /** Optional wire data must fail closed when constructing this context. */
  readonly mayOfferDraw: boolean;
}

/** Pre-roll DFEN; no exposed legal moves or rolled dice. */
export type DrawDecisionContext = DecisionContext;

/** Empty moves are NOT a forced-pass command. The server auto-passes. */
export interface TurnAction {
  readonly moves: readonly string[];
  readonly offerDraw?: boolean;
  readonly resign?: boolean;
}

export interface DrawAction {
  readonly acceptDraw: boolean;
  readonly resign?: boolean;
}

/** The handler will enforce cancellation/deadlines in the implementation stage. */
export interface DecisionControl {
  readonly signal: AbortSignal;
  readonly deadlineEpochMs: number;
}

export interface BotStrategy {
  onTurn(
    context: TurnContext,
    control: DecisionControl,
  ): TurnAction | Promise<TurnAction>;
  /** Absent callback will explicitly decline; no hidden acceptance. */
  onDrawDecision?(
    context: DrawDecisionContext,
    control: DecisionControl,
  ): DrawAction | Promise<DrawAction>;
}

/** Planned handler error taxonomy, not an implemented exception API. */
export type RuntimeErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "unsupported_delivery"
  | "missing_legal_moves"
  | "stale_context"
  | "deadline_exceeded"
  | "strategy_failed";
