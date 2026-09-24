# Contributing

This repository currently contains documentation, not a runnable library.

- Use a branch such as `docs/architecture` or `feat/webhook-handler`.
- Keep code documentation and GitHub-facing text in English.
- Keep each PR scoped to one milestone or a bounded part of it.
- Run `git diff --check` before committing. Current CI checks documentation
  presence and commit whitespace, not runtime behavior.
- Add pinned tooling and meaningful offline tests with the first implementation.
- Use synthetic public fixtures, never credentials or production configuration.
- Follow [AGENTS.md](AGENTS.md) and [SECURITY.md](SECURITY.md).
- The owner reviews and merges. Releases and deployments are separate operations.

Documentation-only bootstrap work may use a PR directly. Feature and bug issues
follow the organization issue workflow. Contributions use the [MIT license](LICENSE).
