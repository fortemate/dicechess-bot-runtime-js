import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--output" && args[1]),
  "Usage: check-package.mjs [--output NEW_DIRECTORY]",
);
const temporary = await mkdtemp(join(tmpdir(), "dicechess-runtime-package-"));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", timeout: 60000 });

try {
  // Packing must rebuild, not accidentally ship stale generated output.
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(
    join(root, "dist/stale-package-marker.js"),
    "throw new Error('stale build');\n",
  );
  const [packed] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", temporary], root),
  );
  assert.equal(basename(packed.filename), packed.filename);
  const names = packed.files.map(({ path }) => path).sort();
  assert.deepEqual(names, [
    "LICENSE",
    "README.md",
    "dist/boundary.d.ts",
    "dist/boundary.js",
    "dist/handler.d.ts",
    "dist/handler.js",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/node.d.ts",
    "dist/node.js",
    "dist/protocol.d.ts",
    "dist/protocol.js",
    "package.json",
  ]);
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--prefix",
      consumer,
      join(temporary, packed.filename),
    ],
    consumer,
  );
  const installed = join(
    consumer,
    "node_modules/@fortemate/dicechess-bot-runtime",
  );
  const metadata = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.equal(metadata.private, undefined);
  const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(metadata.version, source.version);
  assert.deepEqual(metadata.publishConfig, {
    access: "public",
    tag: "next",
    registry: "https://registry.npmjs.org/",
  });
  assert.equal(metadata.type, "module");
  assert.equal(metadata.exports["."].types, "./dist/index.d.ts");
  assert.equal(metadata.exports["."].import, "./dist/index.js");
  assert.equal(metadata.exports["./node"].import, "./dist/node.js");
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  await readFile(join(installed, "dist/index.d.ts"), "utf8");
  const typeConsumer = join(consumer, "types.mts");
  await writeFile(
    typeConsumer,
    await readFile(join(root, "tests/types.ts"), "utf8"),
  );
  run(
    join(root, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--lib",
      "ES2022,DOM",
      "--types",
      "node",
      "--typeRoots",
      join(root, "node_modules/@types"),
      typeConsumer,
    ],
    consumer,
  );

  const assertion = `
if (runtime.VERIFICATION_VERSION !== 2 || runtime.CONTRACT_DELIVERY_TYPES.length !== 2) {
  throw new Error("Package entry contract mismatch");
}
const handler = runtime.createWebhookHandler({
  keys: { active: "synthetic-package-test-key" },
  limits: { timeoutMs: 1000, maxBodyBytes: 65536, maxTreeNodes: 100, maxTreeDepth: 8, maxConcurrentRequests: 4, maxCacheEntries: 8, cacheTtlMs: 1000 },
  strategy: { onTurn() { throw new Error("Unauthenticated dispatch"); } },
});
const response = await handler(new Request("https://bot.invalid", { method: "POST", body: "{}" }));
if (response.status !== 401 || (await response.json()).error !== "unauthorized") throw new Error("Package handler boundary mismatch");
console.log("Isolated package consumer passed");
`;
  const nodeEntry = join(consumer, "node-consumer.mjs");
  await writeFile(
    nodeEntry,
    'import * as runtime from "@fortemate/dicechess-bot-runtime";\n' +
      'import { createNodeListener } from "@fortemate/dicechess-bot-runtime/node";\nif (typeof createNodeListener !== "function") throw new Error("Node export missing");\n' +
      assertion,
  );
  process.stdout.write(run(process.execPath, [nodeEntry], consumer));
  const denoEntry = join(consumer, "deno-consumer.mjs");
  await writeFile(
    denoEntry,
    'import * as runtime from "./node_modules/@fortemate/dicechess-bot-runtime/dist/index.js";\n' +
      assertion,
  );
  process.stdout.write(
    run(
      "deno",
      ["run", "--no-config", "--no-npm", "--cached-only", denoEntry],
      consumer,
    ),
  );
  console.log(
    "Verified packed files, Node package exports, and Deno built entry; nothing published.",
  );
  if (args.length) {
    // Refuse existing destinations; retain only the exact archive tested above.
    await mkdir(args[1]);
    await copyFile(
      join(temporary, packed.filename),
      join(args[1], packed.filename),
    );
  }
} finally {
  // This directory is exclusively owned by this invocation of mkdtemp.
  await rm(temporary, { recursive: true, force: true });
}
