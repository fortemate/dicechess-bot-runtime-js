# Dice Chess Bot Runtime JS

Shared TypeScript runtime for Dice Chess webhook bots.

**Status: contract/build foundation.** Protocol types, constants, synthetic
fixtures, and cross-runtime checks exist. No webhook handler or published npm
package exists yet. Do not use this foundation to authenticate live deliveries.

## Scope

The runtime will handle authenticated webhook delivery, ownership verification,
typed asynchronous strategy callbacks, legal-tree retrieval, and response
construction. Bot authors supply playing decisions.

The library must not depend on the engine, Jev, prompts, or any playing strategy.
Portable core logic and thin HTTP adapters will be tested separately.

Local package name: `@fortemate/dicechess-bot-runtime`, ESM with TypeScript
declarations. It remains `private: true` and has no runtime dependencies. The name
is not reserved or published. The only export is the package root; internals,
fixtures, and build tools are not part of the package API.

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

These checks establish fixture and build compatibility on the pinned versions,
not a working runtime. They do not execute upstream JVM tests or validate live
gameplay. See [fixture provenance and limits](fixtures/README.md).

## License

[MIT](LICENSE). Copyright (c) 2026 Fortemate.
