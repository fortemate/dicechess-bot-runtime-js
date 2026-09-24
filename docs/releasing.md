# Owner-triggered npm release checklist

## GitHub Actions (recommended)

The **npm release** workflow (`npm-publish.yaml`) follows the engine's checked
artifact/OIDC pattern, without its JVM/Wasm builds, mirrors, tags, or version-bump
automation. It runs only on manual dispatch on `main` in this repository.

It validates Node 22/24/26 and Deno, then packs and tests the exact archive, retaining
it with a commit/version/SHA-512 manifest as `npm-release-<run-id>-<run-attempt>`
for 90 days. The job summary records the manifest checksum. Only the publishing
job receives `id-token: write`; it verifies the downloaded bundle, installs no
dependencies, and publishes without lifecycle scripts via npm OIDC with provenance.
No permanent npm token is needed. Agents must not dispatch the workflow.

### First publication and trust setup

npm requires a package to exist before configuring its Trusted Publisher. The
engine's trust does not authorize this new package. For the first version:

1. Run **npm release** on `main`, enter `0.1.0-alpha.1`, and leave **publish unchecked**.
2. Wait for successful checks and download/extract the artifact into a new directory.
   From the exact source commit, verify against the checksum from the job summary:

   ```sh
   node scripts/npm-release.mjs verify /absolute/path/to/extracted-bundle \
     0.1.0-alpha.1 <approved-commit-sha> <manifest-integrity-from-job-summary>
   ```

3. Publish that exact archive manually using the owner-only instructions below.
   This local bootstrap does not receive GitHub Actions OIDC provenance.
4. Create GitHub environment **npm**, restrict deployment branches to `main`, and
   configure required reviewers. The workflow alone does not add these protections.
5. In npm package settings, add a GitHub Actions Trusted Publisher:

   | Setting           | Value                                |
   | ----------------- | ------------------------------------ |
   | Organization      | `fortemate`                          |
   | Repository        | `dicechess-bot-runtime-js`           |
   | Workflow filename | `npm-publish.yaml`                   |
   | Environment       | `npm`                                |
   | Direct publishing | Allowed (stage-only is insufficient) |

   Alternatively, the owner can use npm 11.15.0+ with 2FA and package write access:

   ```sh
   npm trust github @fortemate/dicechess-bot-runtime \
     --repo fortemate/dicechess-bot-runtime-js --file npm-publish.yaml \
     --env npm --allow-publish
   ```

No account configuration or publication is performed by this change.

### Subsequent versions and recovery

Merge a reviewed version change in package.json and package-lock.json. Run the
workflow on `main` with the exact version and **publish selected**, then approve
the environment after inspecting the bundle. Prereleases use `next`. A future
stable release also requires updating `publishConfig.tag` and its package-check
expectation to `latest`.

An existing version is skipped only if its integrity matches; it is never retagged.
Different bytes, authentication errors, and unexpected registry responses fail
closed. Only a 404 means absent. After a write, registry propagation is checked
up to 12 times at 10-second intervals, with a 15-second timeout per read.
A failed write or timed-out job may already have published: inspect the registry
before retrying and retain the original bundle. Re-run **all jobs** of the original
run, not only the publisher (artifact names include run attempt). Do not rebuild
another commit under an existing version. Dist-tag correction is a separate owner
action. A green preparation job alone is not publication evidence.

References: [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Local fallback / first bootstrap

Status: preparation only. Candidate: `@fortemate/dicechess-bot-runtime@0.1.0-alpha.1`.
No package is published by ordinary CI or preparation-only runs. No Git tag or
GitHub release is created by this workflow. The first
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
release_parent=$(mktemp -d)
release_dir="$release_parent/bundle"
node scripts/check-package.mjs --output "$release_dir"
```

Inspect the listed files and the archive. The expected filename for this candidate
is `fortemate-dicechess-bot-runtime-0.1.0-alpha.1.tgz`. Record its SHA-512 integrity and the
approved Git commit. Keep this exact archive for the publication step.

## Publish — human action only

Do not execute this section as an agent. The owner authenticates interactively
and publishes the inspected archive; never store an npm token in the repository.

```sh
npm publish "$release_dir/fortemate-dicechess-bot-runtime-0.1.0-alpha.1.tgz" \
  --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
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
