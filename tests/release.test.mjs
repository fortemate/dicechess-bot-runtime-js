import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  integrity,
  packageName,
  publishVerified,
  registryIntegrity,
  validateIdentity,
  verifyBundle,
} from "../scripts/npm-release.mjs";

const version = "0.1.0-alpha.1";
const sha = "a".repeat(40);
const manifest = {
  name: packageName,
  version,
  sha,
  filename: `fortemate-dicechess-bot-runtime-${version}.tgz`,
  tag: "next",
  integrity: integrity("synthetic archive"),
};

test("release identity rejects paths and invalid commit hashes", () => {
  validateIdentity(version, sha);
  for (const value of ["../x", "01.0.0", "1.0", "1.0.0\n", "1.0.0+unsafe"])
    assert.throws(() => validateIdentity(value, sha));
  assert.throws(() => validateIdentity(version, "main"));
});

test("bundle verification binds bytes, identity, path and commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-release-test-"));
  try {
    await writeFile(join(directory, manifest.filename), "synthetic archive");
    const save = async (value) => {
      const bytes = JSON.stringify(value);
      await writeFile(join(directory, "manifest.json"), bytes);
      return integrity(bytes);
    };
    const digest = await save(manifest);
    assert.deepEqual(
      await verifyBundle(directory, version, sha, digest),
      manifest,
    );
    await assert.rejects(
      verifyBundle(directory, version, "b".repeat(40), digest),
    );
    await assert.rejects(verifyBundle(directory, version, sha, "wrong"));
    for (const change of [
      { filename: "../escape.tgz" },
      { name: "wrong" },
      { version: "0.2.0" },
      { tag: "latest" },
    ]) {
      await assert.rejects(
        verifyBundle(
          directory,
          version,
          sha,
          await save({ ...manifest, ...change }),
        ),
      );
    }
    await save(manifest);
    await writeFile(join(directory, manifest.filename), "tampered");
    await assert.rejects(verifyBundle(directory, version, sha, digest));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("registry lookup treats only 404 as absent and validates returned identity", async () => {
  assert.equal(
    await registryIntegrity(version, async () => ({ status: 404 })),
    null,
  );
  for (const status of [401, 403, 429, 500])
    await assert.rejects(registryIntegrity(version, async () => ({ status })));
  await assert.rejects(
    registryIntegrity(version, async () => {
      throw new Error("offline");
    }),
  );
  const body = {
    name: packageName,
    version,
    dist: { integrity: manifest.integrity },
  };
  assert.equal(
    await registryIntegrity(version, async () => ({
      status: 200,
      json: async () => body,
    })),
    manifest.integrity,
  );
  await assert.rejects(
    registryIntegrity(version, async () => ({
      status: 200,
      json: async () => ({ ...body, version: "wrong" }),
    })),
  );
});

test("matching existing version skips publication; conflicts fail closed", async () => {
  const publish = () => assert.fail("must not publish");
  assert.match(
    await publishVerified(manifest, "/synthetic", {
      lookup: async () => manifest.integrity,
      publish,
    }),
    /Existing/,
  );
  await assert.rejects(
    publishVerified(manifest, "/synthetic", {
      lookup: async () => "different",
      publish,
    }),
  );
  await assert.rejects(
    publishVerified(manifest, "/synthetic", {
      lookup: async () => {
        throw new Error("registry failure");
      },
      publish,
    }),
  );
});

test("publishes exact archive once and waits for bounded propagation", async () => {
  let reads = 0,
    writes = 0,
    waits = 0;
  const result = await publishVerified(manifest, "/synthetic", {
    lookup: async () => (++reads === 3 ? manifest.integrity : null),
    publish: async (file, tag) => {
      writes++;
      assert.equal(file, `/synthetic/${manifest.filename}`);
      assert.equal(tag, "next");
    },
    wait: async () => {
      waits++;
    },
  });
  assert.match(result, /verified/);
  assert.equal(writes, 1);
  assert.equal(waits, 1);
});

test("uncertain write is never repeated; readback can prove success", async () => {
  let reads = 0;
  assert.match(
    await publishVerified(manifest, "/synthetic", {
      lookup: async () => (++reads === 1 ? null : manifest.integrity),
      publish: async () => {
        throw new Error("connection lost");
      },
    }),
    /verified/,
  );
  let writes = 0,
    waits = 0;
  await assert.rejects(
    publishVerified(manifest, "/synthetic", {
      lookup: async () => null,
      publish: async () => {
        writes++;
      },
      wait: async () => {
        waits++;
      },
    }),
    /may have succeeded/,
  );
  assert.equal(writes, 1);
  assert.equal(waits, 11);
  reads = 0;
  await assert.rejects(
    publishVerified(manifest, "/synthetic", {
      lookup: async () => (++reads === 1 ? null : "wrong"),
      publish: async () => {},
    }),
    /differs/,
  );
});
