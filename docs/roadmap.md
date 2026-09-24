# Roadmap

Deliver each milestone as a separate reviewable change. The contract/build
foundation and portable webhook runtime are implemented; consumer migrations
remain pending. Implementation status is not release or deployment status.

## 1. Contract and build

Status: implemented. See [Protocol contract](protocol.md) and the offline gate.

Pin public protocol/reference revisions, TypeScript tools, and supported Node.js
and Deno versions. Specify events, capabilities, errors, legal-tree semantics,
and package exports. Add formatting, type checks, tests, and synthetic fixtures.

Acceptance: offline CI runs on both initial environments; authentication and
context behavior are explicitly specified.

## 2. Portable webhook runtime

Status: implemented with offline handler, package, and Node adapter tests.

Implement typed async strategies, envelope validation, signatures, verification
v2, active/pending keys, response serialization, fallback move-tree retrieval,
deadlines, cancellation, and explicit duplicate-delivery behavior. Add thin HTTP
adapters and built-package consumer tests.

The pinned server's readiness compatibility is explicit authenticated no-version
opt-in; see [the contract](protocol.md#delivery-types-and-capabilities).
Signed v2 setup alone does not establish live catalog/showcase readiness.

Acceptance: valid requests reach the right callback; invalid, unsupported, stale,
or expired requests do not produce a gameplay response. No engine, model SDK,
live credentials, or paid service is needed.

Core behavior includes required limits, frozen contexts, full-leaf move validation,
bound fallback retrieval, clock-clamped deadlines, and TTL-bounded process-local
deduplication. Failures never silently become strategy choices. Distributed
exactly-once execution is not provided.

## 3. First consumer

Prerequisite: Node 22/24/26 package checks and public prerelease metadata are
prepared. The owner must complete [the release checklist](releasing.md) before
the starter can consume a published version. No release is implied by this PR.

Migrate dicechess-bot-typescript in a separate authorized PR. Preserve its
playing strategy and compare protocol behavior against the shared fixtures.

Acceptance: offline integration tests show that the runtime replaces duplicated
transport. Document intentional protocol corrections. Package publication and
consumer deployment remain owner operations.

## 4. Jev and incremental adoption

Update the Jev implementation plan to TypeScript when that work begins. Keep its
adaptive selection, engine, and provider integration outside this runtime.
Migrate other consumers one at a time, separately from algorithm changes.

Acceptance: every consumer has its own compatibility evidence; neither a fleet
migration nor a deployment is implied by library completion.
