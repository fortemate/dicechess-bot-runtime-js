# Architecture

Status: agreed direction; implementation pending.

## Protocol authority

The current public play-api contract is authoritative. The
[JVM runtime](https://github.com/fortemate/dicechess-bot-runtime) is a reference
implementation and a source of test vectors, not a requirement to copy Java APIs.

Before implementation, pin contract revisions and inventory delivery types,
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

Initial targets are Node.js and Deno, with exact supported versions pinned in
the build milestone. Other environments need adapter tests before being
advertised as supported.

## Authentication and state

- Verify signatures over original request bytes, never reserialized JSON.
- Authenticate gameplay deliveries before strategy dispatch.
- Implement signed verification v2 and active/pending key rules. Never silently
  fall back to an unsigned legacy handshake.
- Validate delivery types and preserve game identity, seat, state version, DFEN,
  and clock semantics.
- Distinguish missing legal moves from an empty legal tree.
- Bind fallback move-tree retrieval to the original context; reject mismatches.
- Bound input sizes and remote responses and redact sensitive diagnostics.
- Follow optional draw/doubling capability contracts. Do not advertise
  unsupported capabilities or dispatch their events as ordinary turns.

Use one delivery deadline across fallback requests and strategy work.
Cancellation must prevent late results from becoming successful responses.
Define retry and duplicate-delivery behavior; an in-memory cache cannot promise
distributed exactly-once execution. Failures must not silently become empty
moves, resignations, or another playing strategy.

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
