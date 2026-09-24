# Contributing

This repository contains protocol types and a tested build, not a webhook handler.

- Use a branch such as `docs/architecture` or `feat/webhook-handler`.
- Keep code documentation and GitHub-facing text in English.
- Keep each PR scoped to one milestone or a bounded part of it.
- Use `mise install` and `mise run setup` once, then `mise run format`,
  `mise run check`, and `git diff --check` before every commit.
- CI runs the same npm check gate on pinned Node.js and Deno. Fixture oracles do
  not prove runtime behavior; add handler tests when implementing the handler.
- Use synthetic public fixtures, never credentials or production configuration.
- Follow [AGENTS.md](AGENTS.md) and [SECURITY.md](SECURITY.md).
- The owner reviews and merges. Releases and deployments are separate operations.

Documentation-only bootstrap work may use a PR directly. Feature and bug issues
follow the organization issue workflow. Contributions use the [MIT license](LICENSE).
