# Pinned webhook contract

This is the specification for the upcoming JS handler, not a claim that it is
implemented. The current package exports constants and types only.

## Public references

Verified on 2026-09-24:

- play-api `e0d9ff54e462126b8d5f0bc2d270938587a60d3c`:
  [wire models](https://github.com/fortemate/dicechess-play-api/blob/e0d9ff54e462126b8d5f0bc2d270938587a60d3c/src/main/scala/dicechess/play/core/Protocol.scala),
  [delivery](https://github.com/fortemate/dicechess-play-api/blob/e0d9ff54e462126b8d5f0bc2d270938587a60d3c/src/main/scala/dicechess/play/server/Webhooks.scala),
  [cryptographic framing](https://github.com/fortemate/dicechess-play-api/blob/e0d9ff54e462126b8d5f0bc2d270938587a60d3c/src/main/scala/dicechess/play/server/WebhookSecurity.scala).
- JVM runtime `798196d564657d3f7b6eb5be4e5227b92ebb9266`:
  [handler](https://github.com/fortemate/dicechess-bot-runtime/blob/798196d564657d3f7b6eb5be4e5227b92ebb9266/src/main/java/com/fortemate/dicechess/runtime/WebhookHandler.java),
  [signatures](https://github.com/fortemate/dicechess-bot-runtime/blob/798196d564657d3f7b6eb5be4e5227b92ebb9266/src/main/java/com/fortemate/dicechess/runtime/Signatures.java).

These are repository contracts, not evidence about a live deployment. Pin changes
require contract review and fixture updates. The server is authoritative when
implementations disagree.

## Delivery types and capabilities

| Type                      | Required state                                                           | Strategy response              |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| `verification`, version 2 | Pending-key authentication; bot, setupId, revision, nonce                | `{nonce, proof}`               |
| `yourTurn`                | Seat matches activeSeat; dicePending is true                             | `{moves, offerDraw?, resign?}` |
| `drawDecision`            | Seat matches activeSeat; dicePending is false; drawOffer.pending is true | `{acceptDraw, resign?}`        |

The `draws` capability enables pre-roll draw decisions. Without an intentional
callback, the planned JS handler explicitly declines. Offering a draw is a turn
action and must obey `mayOfferDraw`. A missing/malformed optional permission must
become false, not a truthy coercion. An explicit strategy resignation is distinct
from a runtime failure.

The pinned JVM runtime also implements `doubleOpportunity` and `doubleDecision`,
but the pinned server does not emit them. JS does not export or advertise their
capability yet. Unknown delivery types must be rejected, never sent to onTurn.

The pinned JVM/server retain legacy verification paths. The new JS handler will
support signed v2 only; legacy or missing verification versions must fail rather
than silently echo a nonce. This is an intentional narrower compatibility surface.

**Adoption blocker to resolve in the handler milestone:** the pinned server's
`Webhooks.wake` still sends a no-version verification envelope for catalog and
showcase readiness, even for an existing registration. Rejecting legacy shapes
therefore fails those probes after successful v2 setup too. Before migrating a
consumer, explicitly resolve authenticated readiness-probe compatibility (the
server signs wake deliveries with the stored key) or coordinate a server protocol
change. Do not silently add unsigned acceptance to make readiness pass.

## Authentication

Secrets are UTF-8 strings, even when they look hexadecimal. Incoming headers are
case-insensitive `X-DiceChess-Timestamp` (integer Unix seconds) and
`X-DiceChess-Signature` (lowercase hex HMAC-SHA256).

Request signature input is `timestamp + "." + rawBody`. Authenticate the exact
received bytes, not parsed/reformatted JSON. The reference freshness interval is
inclusive plus/minus 300 seconds; parsing and boundary rejection require handler
tests. Freshness alone is not delivery deduplication.

Gameplay verification accepts configured active/pending keys during rotation;
v2 activation must use the pending key only. The activation proof input is
`"dicechess-webhook-activate-v2\n" + rawBody`, with an actual LF in the prefix.

V2 requires nonblank bot.team, bot.name, setupId, revision and a canonical,
unpadded base64url nonce decoding to at least 16 bytes. The response echoes the
nonce and supplies the domain-separated proof. Authentication failures never
invoke a strategy.

[Fixture provenance](../fixtures/README.md) records two different upstream v2
vectors. Both are recomputed on Node and Deno; neither is renamed as the other's
canonical vector.

## Context and legal moves

The consumed wire subset is `{type,gameId,seat,state}`. Preserve state.version,
state.dfen, activeSeat and dicePending. Other snapshot fields are not strategy
inputs by default. Context types are readonly at compile time; this foundation
does not perform parsing, copying, or freezing of network data.

Wire clocks are `{white,black}` in milliseconds or null. Normalize them relative
to the delivery seat as remainingMillis/opponentRemainingMillis. The optional
Fischer increment is timeControl.Fischer.incrementSeconds multiplied by 1000;
otherwise incrementMillis is null. Invalid optional increments fail closed;
required clock numbers must be nonnegative safe integers.

The server/JVM use signed 64-bit versions. JS boundary validation must reject
numbers outside Number.isSafeInteger rather than silently rounding them. This is
an explicit limitation pending any future lossless-integer design.

Legal moves use recursive `{uci: subtree}` objects. A non-root empty object is a
leaf completing a turn; an empty root means no legal turn and server auto-pass.
Shorter terminal paths remain valid. Never invent an empty selectable turn or
prune the original tree.

Absent/null legalMoves means unavailable, not empty. The JVM leaves an absent
field unknown and fetches only explicit null when configured. The planned JS
policy may resolve either absent or null via a configured fallback; this
difference is explicit and must receive tests before implementation.

Fallback `GET /games/{id}/moves` returns
`{version,dfen,dicePending,legalMoves}`. Accept it only when version and DFEN match
the original delivery and dicePending is true. Missing, failed, malformed, or
mismatching fetches cannot become `{}`. Validate returned tree structure and
bound its size before exposing it.

Pre-roll draw contexts expose no legalMoves or dice-specific fields. DFEN remains
opaque to this library; no engine is imported to interpret or regenerate it.

## Planned handler error contract

| Code                 | Meaning                                       | Gameplay action |
| -------------------- | --------------------------------------------- | --------------- |
| invalid_request      | Malformed envelope, context or unsafe numbers | None            |
| unauthorized         | Invalid signature, key or freshness           | None            |
| unsupported_delivery | Unknown event/capability/version              | None            |
| missing_legal_moves  | Required tree unavailable                     | None            |
| stale_context        | Fallback context does not match               | None            |
| deadline_exceeded    | Delivery budget expired or work cancelled     | None            |
| strategy_failed      | Callback failed or returned invalid output    | None            |

These are exported type names, not exception classes or implemented responses.
The handler milestone must specify/test HTTP status mapping against server retry
behavior, duplicate handling, body limits, timeout enforcement, and safe messages.
It must never turn a failure into random play, pass, resignation, or a late success.

## Package and validation contract

ESM-only root export with declaration files; no CommonJS, engine, model SDK or
runtime dependencies. Node.js 26.8.2 and Deno 2.9.7 are the tested foundation
versions. Tests validate protocol examples and packed build portability only.
The types do not authenticate requests or validate JSON. No npm release, consumer
migration, registration, or live game is part of this milestone.
