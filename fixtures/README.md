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
context projection and tree walking are specification oracles, not an
implementation of the future runtime. Passing these tests does not prove request
authentication, replay rejection, dispatch, deadline enforcement, or fetch logic.
Those must be tested against real library code in milestone 2.

No new Java/Scala test execution is claimed here: source provenance is pinned and
the expected upstream vector values are checked locally in Node.js and Deno.
