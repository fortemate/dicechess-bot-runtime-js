import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const packageName = "@fortemate/dicechess-bot-runtime";
const registry = "https://registry.npmjs.org/";
export const integrity = (bytes) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

export function validateIdentity(version, sha) {
  assert.equal(version.trim(), version);
  assert.equal(sha.trim(), sha);
  assert.match(
    version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  assert.match(sha, /^[0-9a-f]{40}$/);
}

export async function verifyBundle(directory, version, sha, expectedDigest) {
  validateIdentity(version, sha);
  const bytes = await readFile(join(directory, "manifest.json"));
  assert.equal(integrity(bytes), expectedDigest, "Manifest checksum mismatch");
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.version, version);
  assert.equal(manifest.sha, sha);
  assert.equal(
    manifest.filename,
    `fortemate-dicechess-bot-runtime-${version}.tgz`,
  );
  assert.equal(manifest.tag, version.includes("-") ? "next" : "latest");
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [manifest.filename, "manifest.json"].sort(),
  );
  assert.equal(
    integrity(await readFile(join(directory, manifest.filename))),
    manifest.integrity,
    "Archive checksum mismatch",
  );
  return manifest;
}

export async function registryIntegrity(version, fetcher = fetch) {
  const response = await fetcher(
    `${registry}${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
    {
      signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 404) return null;
  assert.equal(
    response.status,
    200,
    `Registry lookup failed: HTTP ${response.status}`,
  );
  const body = await response.json();
  assert.equal(body.name, packageName);
  assert.equal(body.version, version);
  assert.equal(
    typeof body.dist?.integrity,
    "string",
    "Registry integrity missing",
  );
  return body.dist.integrity;
}

export async function publishVerified(
  manifest,
  directory,
  {
    lookup = registryIntegrity,
    publish = (file, tag) =>
      execFileSync(
        "npm",
        [
          "publish",
          file,
          "--ignore-scripts",
          "--access",
          "public",
          "--tag",
          tag,
          "--provenance",
          `--registry=${registry}`,
        ],
        { stdio: "inherit", timeout: 120000 },
      ),
    wait = () => new Promise((done) => setTimeout(done, 10000)),
  } = {},
) {
  const existing = await lookup(manifest.version);
  if (existing !== null) {
    assert.equal(
      existing,
      manifest.integrity,
      "Published version has different bytes; refusing publication",
    );
    return "Existing version verified; no publication or dist-tag change";
  }
  // A failed client can still have published successfully. Never retry the write here.
  let publishError;
  try {
    await publish(resolve(directory, manifest.filename), manifest.tag);
  } catch (error) {
    publishError = error;
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const found = await lookup(manifest.version);
    if (found !== null) {
      assert.equal(
        found,
        manifest.integrity,
        "Registry archive differs from tested archive",
      );
      return "Published version integrity verified";
    }
    if (attempt < 11) await wait();
  }
  throw new Error(
    "Publication unconfirmed; it may have succeeded. Inspect registry before retrying; retain this artifact.",
    { cause: publishError },
  );
}

async function main() {
  const [command, directory, version, sha, digest] = process.argv.slice(2);
  assert.ok(
    directory && version && sha,
    "Usage: npm-release.mjs prepare|verify|publish DIRECTORY VERSION SHA [MANIFEST_INTEGRITY]",
  );
  validateIdentity(version, sha);
  if (command === "prepare") {
    const source = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.equal(source.name, packageName);
    assert.equal(source.version, version);
    const filename = `fortemate-dicechess-bot-runtime-${version}.tgz`;
    assert.deepEqual(await readdir(directory), [filename]);
    const tag = version.includes("-") ? "next" : "latest";
    assert.deepEqual(source.publishConfig, { access: "public", tag, registry });
    const manifest = {
      name: packageName,
      version,
      sha,
      filename,
      tag,
      integrity: integrity(await readFile(join(directory, filename))),
    };
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    await writeFile(join(directory, "manifest.json"), bytes, { flag: "wx" });
    console.log(integrity(bytes));
    return;
  }
  assert.ok(command === "verify" || command === "publish", "Unknown command");
  const manifest = await verifyBundle(directory, version, sha, digest);
  console.log(
    command === "publish"
      ? await publishVerified(manifest, directory)
      : "Bundle verified; nothing published",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
