# Owner-only npm release checklist

Status: preparation only. Candidate: `@fortemate/dicechess-bot-runtime@0.1.0-alpha.1`.
No package, Git tag, or GitHub release is created by CI or this change. The first
consumer migration and any deployment remain separate work.

## Approval and account prerequisites

- The owner reviews and merges the preparation PR, including the selected version.
- Confirm npm account membership and publish permission for the `@fortemate` scope,
  name availability, and the required interactive authentication/2FA. A public
  registry lookup returning 404 is not proof of scope ownership or name reservation.
- Use a clean checkout of the approved commit. Inspect package contents and licenses;
  do not include credentials, local configuration, fixtures, or development tools.
- Confirm CI passes on Node 22.23.3, 24.21.0, and 26.8.2, including Deno 2.9.7.
  Cloud-hosted support is not established by these runtime checks.

## Prepare and inspect locally (no publication)

```sh
mise install
mise run setup
mise run format
mise run check
git diff --exit-code
git status --short
npm pack --dry-run
```

`prepack` cleans and rebuilds `dist`. The complete check additionally installs a
temporary tarball offline, verifies its exact file list, tests both exports and
Deno, and compiles the consumer against its declarations. No install lifecycle
script is required by consumers. Never use `--ignore-scripts` to pack source for
a release: that would skip the fresh build. `prepublishOnly` runs the full check
when publishing from the source directory, but is not an authorization control.

After review, the owner can create the archive in an empty temporary directory:

```sh
release_dir=$(mktemp -d)
npm pack --json --pack-destination "$release_dir"
```

Inspect the listed files and the archive. The expected filename for this candidate
is `fortemate-dicechess-bot-runtime-0.1.0-alpha.1.tgz`. Record the returned integrity digest and the
approved Git commit. Keep this exact archive for the publication step.

## Publish — human action only

Do not execute this section as an agent. The owner authenticates interactively
and publishes the inspected archive; never store an npm token in the repository.

```sh
npm publish "$release_dir/fortemate-dicechess-bot-runtime-0.1.0-alpha.1.tgz" \
  --access public --tag next --registry=https://registry.npmjs.org/
```

Publishing a tarball does not replace the earlier source checks. The `next` tag
is intentional: do not advertise this initial prerelease as `latest`. Published
name/version pairs cannot be reused; fixes require a new reviewed version. Any
Git tag or GitHub release is also created by the owner, not by this workflow.

## Verify and hand off

Read back the exact version, tags, and registry integrity metadata:

```sh
npm view @fortemate/dicechess-bot-runtime@0.1.0-alpha.1 version dist.integrity \
  --registry=https://registry.npmjs.org/
npm view @fortemate/dicechess-bot-runtime dist-tags --registry=https://registry.npmjs.org/
```

Compare the registry integrity to the inspected archive, then test a clean
consumer install of that exact version. Only after registry verification should
a separate starter PR depend on it. Package publication does not validate bot
registration, readiness, Azure deployment, or live gameplay.

References: [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
and [npm lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/).
