# Pinned webhook contract

The portable handler implements the following contract. Offline tests are not
evidence of a deployment, registration, or live game.

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

Without an onDrawDecision callback, the handler explicitly declines. Offering a
draw requires mayOfferDraw exactly true. Explicit resignation belongs to the
strategy; runtime failures never become resignation or another playing decision.
Doubling is not emitted by the pinned server and is unsupported by this package.
Unknown types never reach onTurn.

**Readiness compatibility:** the pinned server's Webhooks.wake sends a no-version
verification envelope even after v2 registration. By default JS rejects this.
Setting `allowLegacyReadiness: true` explicitly accepts only fresh authenticated
no-version verification using an active or pending key and a nonblank nonce,
returning `{nonce}`. Explicit versions other than 2 remain unsupported, including
1, null, and string-valued versions. This never enables unsigned registration.
Consumer adoption must choose its readiness policy; no live readiness proof is
claimed.

## Authentication

Secrets are UTF-8 strings, even when they look hexadecimal. Header names are
case-insensitive. X-DiceChess-Timestamp must be canonical nonnegative decimal
integer Unix seconds within the safe integer range. X-DiceChess-Signature must
be exactly 64 lowercase hexadecimal characters. Signs, fractions, exponent
notation, duplicate header values, and uppercase signatures are rejected.

Request signature input is `timestamp + "." + rawBody`. Authentication uses the
exact received bytes, never reserialized JSON. Freshness is inclusive plus/minus
300 seconds. Gameplay accepts configured active/pending keys during rotation;
v2 activation authenticates with the pending key only.

V2 requires nonblank bot.team, bot.name, setupId, revision and a canonical
unpadded base64url nonce decoding to at least 16 bytes. The response echoes the
nonce and computes HMAC using the pending key over the actual LF-terminated
prefix `"dicechess-webhook-activate-v2\n"` followed by raw body bytes.
No authentication failure invokes a strategy.

[Fixture provenance](../fixtures/README.md) records distinct server/JVM vectors.

## Contexts, clocks, and legal turns

Consumed fields are gameId, seat, state.version, state.dfen, activeSeat, and
dicePending. Contexts and nested clocks/trees are frozen at runtime, not merely
readonly TypeScript types. No engine or model is imported.

Required numeric fields are nonnegative safe integers represented on the wire
as canonical decimal integer literals. Fractions and exponent forms cannot be
rounded into valid fields. This deliberately rejects some numeric spellings and
signed 64-bit values which JavaScript cannot represent exactly.

Absent/null clocks normalize to null; otherwise both white and black milliseconds
are required. They become remainingMillis/opponentRemainingMillis relative to the
bot's seat. Valid Fischer.incrementSeconds becomes incrementMillis; malformed or
absent optional increments become null. The remaining clock clamps the whole
request budget; it does not reset time already spent authenticating or reading.

Legal trees are recursive `{uci: subtree}` records bounded by node count and
depth. Root counts as a node at depth zero. Edges must be UCI-shaped strings.
Every selected move sequence must reach an original leaf; prefixes, invented
edges, and empty choices on a nonempty tree fail. Shorter terminal paths remain
valid. Empty root returns `{moves: [], offerDraw: false}` without invoking strategy;
the server owns auto-pass. Explicit resignation returns empty moves with resign.

Absent/null legalMoves means unavailable, not empty. With playApiBaseUrl configured,
both trigger `GET /games/{encodedGameId}/moves` through injected/default fetch.
Redirects are rejected; response bytes and tree size are bounded. Version and
DFEN must match the original context and dicePending must be true. A mismatch is
stale_context; failed, missing, or malformed retrieval is missing_legal_moves.
No fallback failure becomes an empty tree.

Draw contexts require six-field pre-roll DFEN and pending drawOffer. They expose
neither legalMoves nor dice fields. DFEN otherwise remains opaque; this package
does not validate game rules.

## Deadlines and duplicate handling

All RuntimeLimits fields are explicit positive safe integers: timeoutMs,
maxBodyBytes, maxTreeNodes, maxTreeDepth, maxConcurrentRequests, maxCacheEntries,
and cacheTtlMs. There are no production tuning defaults. Timeout is limited to
the platform timer range; maximum tree depth is 256.

One monotonic deadline covers body reading, authentication, fallback, and strategy.
Callbacks receive a frozen control with signal and deadlineEpochMs. Request abort
or expiration returns deadline_exceeded and late results cannot become success.
Cancellation is cooperative: noncooperative callbacks cannot be forcibly stopped.

Each handler owns a bounded process-local cache keyed by gameId, seat, version,
and event type. Decision fingerprints compare DFEN, increment, legal tree and
draw permission where relevant; legal edges are normalized and ticking remaining
clocks are excluded. Same-identity changed decision inputs produce stale_context.
Identical in-flight deliveries share work; successful results remain for cacheTtlMs.
Settled failures are removed for retry. Expired entries are pruned on lookup.
A timed-out but unsettled dispatch retains its cache slot until actual work
settles, bounding accumulation of callbacks that ignore cancellation.

The concurrent-request limit bounds active HTTP handling; the cache-entry limit
also bounds retained dispatch work. Capacity exhaustion is explicit. This cache
is neither durable replay protection nor distributed exactly-once execution.
Separate handlers/processes or TTL expiration can repeat a decision.

## HTTP errors and retry semantics

All handler errors are sanitized JSON `{error: code}` without exception messages,
keys, or request data. Responses are JSON with Cache-Control: no-store.

| Code                 | HTTP | Meaning                                                      |
| -------------------- | ---- | ------------------------------------------------------------ |
| invalid_request      | 400  | Malformed envelope, context, unsafe numbers, or legal tree   |
| invalid_request      | 405  | Non-POST request                                             |
| invalid_request      | 413  | Incoming body exceeds configured byte limit                  |
| unauthorized         | 401  | Invalid signature, key, or freshness                         |
| unsupported_delivery | 400  | Unknown event or verification version                        |
| stale_context        | 409  | Conflicting duplicate or mismatching fallback context        |
| missing_legal_moves  | 503  | Required tree unavailable or retrieval failed                |
| capacity_exceeded    | 503  | Request or retained-cache capacity exhausted                 |
| deadline_exceeded    | 504  | Budget expired or request cancelled                          |
| strategy_failed      | 500  | Callback failed, invalid output, or unexpected handler error |

The pinned server treats 4xx delivery failures as terminal and retries 5xx
while its delivery/clock budget allows.
The handler makes no gameplay action out of either class. Retry does not promise
success or exactly-once processing. The Node adapter sanitizes failures outside
the handler as HTTP 500 `{error: "internal_error"}`; once headers are sent it
terminates the failed response.

## Package and validation contract

ESM exports are the portable root and Node-only `/node` createNodeListener adapter,
with declarations and no runtime dependencies. The adapter does not start a
server, read configuration, or register bots. It propagates disconnect cancellation
and bridges HTTP streams. Deno uses the web-standard handler directly.

Node.js 26.8.2 and Deno 2.9.7 are the pinned validation environments. Tests cover
the real handler, offline fixtures, and package consumers; Node adapter checks use
local loopback only. No new upstream JVM test execution, npm release, consumer
migration, registration, deployment, or live game is implied.
