# Protocol fixtures

All inputs are public synthetic examples, not production games or credentials.

- `verification-v2.json`: two distinct upstream protocol vectors. Each records
  its immutable source URL. Secret strings are UTF-8 key bytes, never hex-decoded.
  The exact raw-body strings have no trailing newline.
- `contexts.json`: newly authored minimal snapshots and expected normalized
  contexts (not complete public-game snapshots). Both seats, timed/untimed,
  missing/null/empty move trees, fail-closed draw permission, and pre-roll draws.
- `fallback.json`: newly authored expected version/DFEN/pending-dice matching.

The cross-runtime suite independently recomputes upstream expected hashes using
Web Crypto and Node-compatible HMAC and verifies fixture consistency. Test-only
context projection and tree walking remain specification oracles, not handler
tests. Separate auth and handler suites call the built createWebhookHandler with
synthetic signed requests, checking signatures, v2 proof, readiness policy,
context validation, dispatch, fallback, deadlines, and bounded local deduplication.
They share Node/Deno execution; Node adapter tests use local loopback HTTP only.

Offline success is not evidence of durable replay protection, distributed
exactly-once execution, a migrated consumer, deployment, or live gameplay.

No new Java/Scala test execution is claimed here: source provenance is pinned and
the expected upstream vector values are checked locally in Node.js and Deno.
