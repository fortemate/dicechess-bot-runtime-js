# AGENTS.md

Agent guidance for `fortemate/dicechess-bot-runtime-js`.

## Scope and current gate

This is the portable webhook runtime. Read docs/protocol.md, the architecture,
and roadmap before implementation. No published package or migrated consumer exists.

- Keep the library transport-only: no engine, Jev, prompts, or playing strategies.
- Verify the current public server contract using synthetic shared wire fixtures.
- Design a portable async TypeScript API and prove Node.js/Deno compatibility.
- Before every commit run `mise run format`, `mise run check`, and
  `git diff --check`. Initial setup: `mise install` then `mise run setup`.
- The check gate covers formatting, strict exported types, ESM build, the same
  fixture tests on Node.js/Deno, and isolated packed-package consumers.
- Distinguish fixture oracles from actual handler and HTTP-adapter tests. Offline
  authentication, dispatch, deadline, and retry tests do not prove live gameplay.
- Preserve explicit limits, authenticated readiness opt-in, pending-only v2,
  immutable contexts, complete legal paths, and sanitized failure responses.
- Public npm metadata is prepared with owner approval; the package is not yet released.
- Release/tag creation and registry publication remain human-only. Read docs/releasing.md.
- Do not publish packages, migrate other repositories, register bots, or deploy
  without separate task-scoped authorization.
- Release labeling and release automation are not configured in this bootstrap.

## publication

<!-- dc-shared:publication v4 — keep identical across Fortemate repositories -->

- Fortemate is open-core. Public by nature, in the public repositories: their source (engine rules
  and search, feature definitions and extractors, bot templates, the play client and server), serving
  contracts, mechanics, and the programme numbers already published in the project READMEs. Private
  repositories (evaluation service, training pipelines, proprietary evaluators, house bots, analytics,
  infrastructure) stay private in full; this rule governs what may be written into the public ones.
- Always private, wherever it is written: trained weights, opening books, labelled corpora, production
  parameter **values** (search profiles, candidate limits, table sizes, blend weights, time budgets),
  experiment **verdicts** (win rates, feature importance, cost ratios, negative results) and the names
  of private artifacts, hosts and internal paths.
- Before writing to a public repository — code, docs, scaladoc, commit messages, Issues, pull requests,
  review replies — check the text against that list. Values and verdicts go to the private knowledge
  base (`fortemate-internal`, a private repository agents read and write through the owner's access;
  naming it is the address, not a disclosure) and are referenced from public text by page title only;
  examples use placeholders such as `<candidate-limit>` instead of real values.
- The rule is forward-only (ADR 009): nothing already published is retracted and history is never
  rewritten. When unsure whether something is a definition or a verdict, ask the owner before
  publishing.

<!-- /dc-shared:publication -->

## issue-management

<!-- dc-shared:issue-management v7 — keep identical across Fortemate repositories -->

- Classify work with the native GitHub Issue Type: `Bug` (unexpected or incorrect behavior), `Feature` (request, idea, new user-visible capability), `Task` (a specific piece of engineering, research, maintenance or documentation work). Labels on Issues name a technical domain or cross-cutting concern only, never repeat the Type, and must already exist in the repository.
- Never commit to a repository's default branch. Name branches you control `<type>/<short-description>` or `<type>/<issue-id>-<short-description>` with a type from `task|feat|bug|refactor|chore|docs|ci|test|perf`. A branch that carries an Issue id must be closed by its pull request (`Closes #<id>`, or `Closes owner/repository#<id>` across repositories); partial work uses a non-closing reference. Before dispatching an external tool, read the repository's live PR-policy workflow: a tool-managed branch name is acceptable only when that policy allows it and the pull request closes the delegated leaf Issue — never edit a workflow to make a generated branch pass. A delegated pull request and its commits close only their leaf Issue, never a parent or sibling.
- GitHub-facing text is English-only. Every Issue has `Context`, `Objective` and a testable `Definition of Done`; create it with `gh issue create --body-file <file>`, never with an inline multi-line body, and search open and closed Issues across Fortemate repositories for duplicates first. Every actionable Issue (never a pull request) belongs to the organization Project [Fortemate Engineering](https://github.com/orgs/fortemate/projects/1); triage (Type, `Execution tier`, `Status`, `Priority`, labels, relationships, assignee) and the mandatory read-back after every mutation follow the `github-issue-workflow` skill in `fortemate-internal/skills/`.
- `jules` is a live execution trigger, not a label. Jules, Antigravity, CI, delegated subagents and any agent without the current user's explicit task-scoped authorization never apply, reapply or remove it. Dispatch qualification, monitoring, feedback (only a submitted comment starting with `@jules`; every other comment by the triggering user wakes the session too), takeover, the audit-marker rule for closed Issues and the "no bare `#N` in a spec" rule are the `jules-delegation` skill; a repository must pass the `jules-repo-readiness` skill before its first dispatch.
- The human owner reviews, approves and merges pull requests. Agents never merge pull requests or execute releases.

<!-- /dc-shared:issue-management -->

## git-pr

<!-- dc-shared:git-pr v4 — keep identical across Fortemate repositories -->

- Follow the branch-name and Issue-link contract in `dc-shared:issue-management`. Agents that
  choose a branch name follow its canonical grammar; integration-owned branch names are accepted
  only when the target repository's live PR policy allows them.
- **The branch type chooses the release-notes section** — `.github/labeler.yml` turns it into a
  PR label and `.github/release.yml` groups by that label. `task/` is issue-driven work and counts
  as a feature, so a fix belongs on `bug/` even when it closes an issue; `chore/` is the grab-bag
  and files under "Other Changes". A type that maps to no label mis-files the whole PR: play-api
  v0.16.0 shipped ten features under 📚 Documentation because every branch was `task/` (which
  mapped to nothing) while every PR touched AGENTS.md (which mapped to `documentation`).
- Before editing anything: run `git status`. If the tree has unrelated uncommitted work,
  stop and report — never let it bleed into your commit.
- Stage specific files by name. `git add -A` / `git add .` are forbidden.
- Commits, PR descriptions, issues, and review replies are English-only. Commit subjects
  use conventional style: `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`.
- Before opening a PR: make the repo check task pass locally. Never pipe test output
  through `grep`/`head` — it masks exit codes.
- After opening a PR: for substantial PRs comment `@coderabbitai review`, wait a few minutes,
  then triage every bot comment on its merits — address or rebut with evidence, never apply
  blindly. Gemini Code Assist is disabled in these repositories; do not wait for it.
- The human owner reviews, approves, and merges. Never merge a PR, never push tags.
- Split large work into small, reviewable PRs.

<!-- /dc-shared:git-pr -->

## security

<!-- dc-shared:security v3 — keep identical across Fortemate repositories -->

- Never print, log, or commit secrets. Local secrets live only in gitignored files
  (e.g. `.env.local`, `mise.local.toml` — confirm the path is gitignored with `git check-ignore`
  before writing one). Never bypass Git hooks (`--no-verify`).
- Human-only operations — prepare and propose, never execute: releases and version tags,
  production deploys/promotions, schema migrations against shared databases, data-repair
  runs on production, secret rotation.
- Never add private infrastructure details (hostnames, IP addresses, cloud identifiers,
  topology, credentials, tokens) to code, docs, commits, or PRs — regardless of the
  repository's visibility. A private repository is not a safe place for them either;
  operator-specific details belong in an approved private runbook.

<!-- /dc-shared:security -->

## routing

<!-- dc-shared:routing v2 — keep identical across Fortemate repositories -->

Route work by required capability instead of defaulting to the strongest model:

- **Frontier**: architecture, cross-repo contracts, high blast radius (schema, public API,
  release pipeline), ambiguous problems.
- **Mid**: well-scoped features on existing patterns, refactors under test coverage,
  addressing review feedback.
- **Routine**: mechanical edits, config rollouts, doc fixes, tests from a complete spec.

Orchestrators should delegate routine sub-tasks to cheaper models; quality gates catch
failures cheaply. When in doubt, escalate one tier — reviewer time costs more than tokens.

<!-- /dc-shared:routing -->
