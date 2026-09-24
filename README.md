# Dice Chess Bot Runtime JS

Shared TypeScript runtime for Dice Chess webhook bots.

**Status: portable webhook implementation.** Authenticated request handling,
typed strategies, fallback retrieval, deadlines, and bounded local deduplication
are implemented and covered by offline tests. No npm package is published;
consumer migration and live gameplay validation remain separate milestones.

## Scope

The runtime handles authenticated webhook delivery, ownership verification,
typed asynchronous strategy callbacks, legal-tree retrieval, and response
construction. Bot authors supply playing decisions.

The library must not depend on the engine, Jev, prompts, or any playing strategy.
Portable core logic and the thin Node.js HTTP adapter are tested separately.

Local package name: `@fortemate/dicechess-bot-runtime`, ESM with TypeScript
declarations. It remains `private: true` and has no runtime dependencies. The name
is not reserved or published. Exports are the package root and `/node`; internals,
fixtures, and build tools are not part of the package API.

## Handler API

```ts
import {
  createWebhookHandler,
  type WebhookHandlerOptions,
} from "@fortemate/dicechess-bot-runtime";
import { createNodeListener } from "@fortemate/dicechess-bot-runtime/node";

// The application supplies reviewed configuration and its own strategy.
export function buildBot(options: WebhookHandlerOptions) {
  const handle = createWebhookHandler(options);
  return { handle, nodeListener: createNodeListener(handle) };
}
```

The portable handler accepts a web `Request` and returns `Promise<Response>`;
Deno can use it directly. The Node listener bridges `node:http` without starting
a server. Neither entry reads environment variables or registers a bot.

`keys` must contain an active or pending UTF-8 secret; `strategy.onTurn` is
required. Every `limits` field is explicit: `timeoutMs`, `maxBodyBytes`,
`maxTreeNodes`, `maxTreeDepth`, `maxConcurrentRequests`, `maxCacheEntries`, and
`cacheTtlMs`. There are no production tuning defaults. Values must be positive
safe integers; timeout cannot exceed the platform timer range and tree depth
cannot exceed 256. Optional `now` and `fetch` support deterministic tests;
`playApiBaseUrl` enables missing/null legal-tree retrieval.

Verification v2 authenticates with the pending key only. Gameplay accepts active
or pending keys during rotation. `allowLegacyReadiness: true` explicitly enables
the pinned server's signed, no-version readiness probes; it defaults to false.
This never enables unsigned registration or accepts explicit legacy versions.

Callbacks receive frozen normalized contexts and cooperative cancellation with
one delivery deadline, clamped to the bot's remaining clock. Moves must form a
complete original root-to-leaf path. Errors do not become fallback playing
decisions. See [protocol behavior and HTTP errors](docs/protocol.md).

## Plan

1. Specify the current protocol and shared JVM/JS conformance fixtures.
2. Implement a small webhook runtime with Node.js and Deno tests.
3. Migrate the TypeScript starter without changing its playing strategy.
4. Build the Jev bot on TypeScript; migrate other consumers incrementally.

See the pinned [Protocol contract](docs/protocol.md),
[Architecture](docs/architecture.md), and [Roadmap](docs/roadmap.md).
Full JVM parity, every hosting adapter, and fleet migration are not prerequisites
for the first version.

## Related projects

- [JVM runtime](https://github.com/fortemate/dicechess-bot-runtime)
- [TypeScript starter](https://github.com/fortemate/dicechess-bot-typescript)
- [Deno bots](https://github.com/fortemate/dicechess-bots-deno)
- [Jev bot](https://github.com/fortemate/dicechess-bot-jev)
- [Bot API](https://bots.fortemate.com/)

## Development

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[AGENTS.md](AGENTS.md). Pinned tools: Node.js 26.8.2, Deno 2.9.7,
TypeScript 7.0.2, and Prettier 3.9.9.

```sh
mise install
mise run setup
mise run format
mise run check
git diff --check
```

`npm run check` is the same gate used by CI: formatting, ESM build, strict public
type checks, shared fixture tests on Node.js and Deno, and isolated local package
consumers. Installing tools/dependencies requires network access; subsequent
tests use no external services. Deno tests run without network permission.

The package check creates and installs a temporary local tarball offline, tests
Node package exports and the Deno compiled entry, then removes its own temporary
directory. It does not publish anything. TypeScript declarations are checked
using a consumer import through the package export map.

These checks exercise actual handler behavior, synthetic fixtures, package
compatibility, and the Node HTTP adapter on the pinned versions. They do not
execute upstream JVM tests, deploy a consumer, or validate live gameplay.
See [fixture provenance and limits](fixtures/README.md).

## License

[MIT](LICENSE). Copyright (c) 2026 Fortemate.
