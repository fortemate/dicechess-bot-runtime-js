# Architecture

Status: portable webhook handler and Node HTTP adapter implemented; consumer
migration, publication, and live validation remain separate work.

## Protocol authority

The current public play-api contract is authoritative. The
[JVM runtime](https://github.com/fortemate/dicechess-bot-runtime) is a reference
implementation and a source of test vectors, not a requirement to copy Java APIs.

The [protocol contract](protocol.md) pins revisions and inventories delivery types,
optional capabilities, verification versions, response shapes, and errors.
Existing starter handlers are migration inputs, not the specification.

## Boundaries

The portable core owns runtime payload validation, signatures, ownership
verification, typed dispatch, and serialization. TypeScript types alone do not
validate incoming JSON.

Strategies may return promises and own all playing decisions. No engine, model
SDK, prompts, scoring, or opening books belong in the runtime. Preserve complete
legal root-to-leaf paths from the server without pruning or regenerating them.

Use standard web request/response and cryptographic facilities where practical.
Keep environment variables, server startup, signals, and platform SDKs in thin
adapters outside the core. Inject networking and time for deterministic tests.
Start with one package; split only when a consumer demonstrates a need.

The core is tested on Node.js 22.23.3, 24.21.0, 26.8.2 and Deno 2.9.7; the Node HTTP adapter has
separate loopback tests. Other versions and environments need tests before being
advertised as supported. The root exports createWebhookHandler; the Node-only
/node entry exports createNodeListener. Neither starts a server or reads config.

## Authentication and state

- Verify signatures over original request bytes, never reserialized JSON.
- Authenticate gameplay deliveries before strategy dispatch.
- Implement signed verification v2 and active/pending key rules. Never silently
  fall back to an unsigned legacy handshake. Signed no-version readiness probes
  require explicit allowLegacyReadiness opt-in, disabled by default.
- Validate delivery types and preserve game identity, seat, state version, DFEN,
  and clock semantics.
- Distinguish missing legal moves from an empty legal tree.
- Bind fallback move-tree retrieval to the original context; reject mismatches.
- Bound input sizes and remote responses and redact sensitive diagnostics.
- Follow optional capability contracts. The pinned server confirms draws, not
  doubling; keep doubling outside the current exports. Do not advertise
  unsupported capabilities or dispatch their events as ordinary turns.

Use one delivery deadline across fallback requests and strategy work.
Cancellation must prevent late results from becoming successful responses.
Define retry and duplicate-delivery behavior; an in-memory cache cannot promise
distributed exactly-once execution. Failures must not silently become empty
moves, resignations, or another playing strategy.

All resource limits are explicit application inputs; no production defaults are
embedded. The remaining game clock clamps the original monotonic request budget.
Contexts and legal trees are frozen. Consumed numeric values must have canonical
safe integer wire representations. Selected moves must reach an original leaf.

Process-local deduplication keys game, seat, version, and delivery type, comparing
decision inputs rather than ticking clocks. Successful results have a bounded
TTL; failures can retry after work settles. Timed-out noncooperative work retains
a bounded cache slot until it settles. This prevents an endless sequence of
timeouts from bypassing the retained-work limit, but cannot forcibly stop JS.
See the [protocol](protocol.md) for exact normalization, limits, and HTTP errors.

## Conformance and adoption

Use public synthetic fixtures for signatures, exact byte encoding, verification
v2, key selection, malformed envelopes, context mapping, response shapes,
missing legal moves, deadlines, and asynchronous strategies. Run shared wire
fixtures against JVM and JS where applicable; resolve differences against the
server contract rather than assuming either implementation is correct.

Test Node.js and Deno independently, including built-package imports. Migrate
the TypeScript starter first and preserve its strategy behavior with offline
tests. Registration and live gameplay require separate authorization.

## Initial non-goals

Jev integration, game rules, search, all JVM utilities, polling/streaming clients,
registration CLI, all cloud adapters, automatic shutdown resignation, fleet
migration, releases, and deployments are outside the first implementation.
Importing the library must never register bots or start background work.
