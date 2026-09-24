import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "dicechess-runtime-package-"));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", timeout: 60000 });

try {
  const [packed] = JSON.parse(
    run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
      root,
    ),
  );
  assert.equal(basename(packed.filename), packed.filename);
  const names = packed.files.map(({ path }) => path).sort();
  assert.deepEqual(names, [
    "LICENSE",
    "README.md",
    "dist/index.d.ts",
    "dist/index.js",
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
  assert.equal(metadata.private, true);
  assert.equal(metadata.type, "module");
  assert.equal(metadata.exports["."].types, "./dist/index.d.ts");
  assert.equal(metadata.exports["."].import, "./dist/index.js");
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  await readFile(join(installed, "dist/index.d.ts"), "utf8");

  const assertion = `
if (runtime.VERIFICATION_VERSION !== 2 || runtime.CONTRACT_DELIVERY_TYPES.length !== 2) {
  throw new Error("Package entry contract mismatch");
}
console.log("Isolated package consumer passed");
`;
  const nodeEntry = join(consumer, "node-consumer.mjs");
  await writeFile(
    nodeEntry,
    'import * as runtime from "@fortemate/dicechess-bot-runtime";\n' +
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
} finally {
  // This directory is exclusively owned by this invocation of mkdtemp.
  await rm(temporary, { recursive: true, force: true });
}
