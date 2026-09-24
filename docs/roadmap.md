# Roadmap

Deliver each milestone as a separate reviewable change. All implementation
milestones below are pending.

## 1. Contract and build

Pin public protocol/reference revisions, TypeScript tools, and supported Node.js
and Deno versions. Specify events, capabilities, errors, legal-tree semantics,
and package exports. Add formatting, type checks, tests, and synthetic fixtures.

Acceptance: offline CI runs on both initial environments; authentication and
context behavior are explicitly specified.

## 2. Portable webhook runtime

Implement typed async strategies, envelope validation, signatures, verification
v2, active/pending keys, response serialization, fallback move-tree retrieval,
deadlines, cancellation, and explicit duplicate-delivery behavior. Add thin HTTP
adapters and built-package consumer tests.

Acceptance: valid requests reach the right callback; invalid, unsupported, stale,
or expired requests do not produce a gameplay response. No engine, model SDK,
live credentials, or paid service is needed.

## 3. First consumer

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
