# Dice Chess Bot Runtime JS

Shared TypeScript runtime for Dice Chess webhook bots.

**Status: documentation bootstrap.** No runtime implementation or published npm
package exists yet. Node.js and Deno are the planned initial compatibility targets.

## Scope

The runtime will handle authenticated webhook delivery, ownership verification,
typed asynchronous strategy callbacks, legal-tree retrieval, and response
construction. Bot authors supply playing decisions.

The library must not depend on the engine, Jev, prompts, or any playing strategy.
Portable core logic and thin HTTP adapters will be tested separately.

Proposed npm name: `@fortemate/dicechess-bot-runtime`. This is a proposed name,
not a reserved or published package.

## Plan

1. Specify the current protocol and shared JVM/JS conformance fixtures.
2. Implement a small webhook runtime with Node.js and Deno tests.
3. Migrate the TypeScript starter without changing its playing strategy.
4. Build the Jev bot on TypeScript; migrate other consumers incrementally.

See [Architecture](docs/architecture.md) and [Roadmap](docs/roadmap.md).
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
[AGENTS.md](AGENTS.md). For this documentation-only stage run:

```sh
git diff --check
```

CI checks required documentation files and commit whitespace only. Pinned tools,
TypeScript builds, tests, and package validation come with implementation.
No live registration, paid service calls, or deployment is part of the bootstrap.

## License

[MIT](LICENSE). Copyright (c) 2026 Fortemate.
