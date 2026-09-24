import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import vectors from "../fixtures/verification-v2.json" with { type: "json" };
import contexts from "../fixtures/contexts.json" with { type: "json" };
import { createWebhookHandler } from "../dist/index.js";

const timestamp = 1756728000;
const active = "synthetic-active-key";
const pending = "synthetic-pending-key";
const limits = {
  timeoutMs: 1000,
  maxBodyBytes: 65536,
  maxTreeNodes: 100,
  maxTreeDepth: 8,
  maxConcurrentRequests: 16,
  maxCacheEntries: 32,
  cacheTtlMs: 1000,
};
const gameplay = JSON.stringify(contexts[0].envelope);

function signed(body, secret = active, stamp = String(timestamp)) {
  return {
    "x-dicechess-timestamp": stamp,
    "x-dicechess-signature": createHmac("sha256", secret)
      .update(stamp + ".")
      .update(body)
      .digest("hex"),
  };
}

function request(body, headers = signed(body)) {
  return new Request("https://bot.invalid/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function harness(options = {}) {
  let calls = 0;
  const handler = createWebhookHandler({
    keys: { active, pending },
    limits,
    now: () => timestamp * 1000,
    strategy: {
      onTurn() {
        calls++;
        return { moves: ["e2e3"] };
      },
    },
    ...options,
  });
  return { handler, calls: () => calls };
}

async function error(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: code });
}

for (const vector of vectors) {
  test(`handler authenticates and proves ${vector.id} without strategy dispatch`, async () => {
    const app = harness({
      keys: { pending: vector.secret },
      now: () => vector.timestamp * 1000,
    });
    const response = await app.handler(
      request(vector.rawBody, {
        "X-DiceChess-Timestamp": String(vector.timestamp),
        "X-DiceChess-Signature": vector.signature,
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      nonce: JSON.parse(vector.rawBody).nonce,
      proof: vector.proof,
    });
    assert.equal(app.calls(), 0);
  });
}

test("verification v2 never activates an active-only key", async () => {
  const vector = vectors[0];
  const app = harness({ keys: { active: vector.secret } });
  await error(
    await app.handler(
      request(vector.rawBody, signed(vector.rawBody, vector.secret)),
    ),
    401,
    "unauthorized",
  );
  assert.equal(app.calls(), 0);
});

test("verification v2 rejects active signatures while a different pending key exists", async () => {
  const app = harness();
  await error(
    await app.handler(request(vectors[0].rawBody)),
    401,
    "unauthorized",
  );
  assert.equal(app.calls(), 0);
});

for (const key of [active, pending]) {
  test(`gameplay accepts the configured ${key === active ? "active" : "pending"} key during rotation`, async () => {
    const app = harness();
    const response = await app.handler(
      request(gameplay, signed(gameplay, key)),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { moves: ["e2e3"] });
    assert.equal(app.calls(), 1);
  });
}

test("authentication binds exact raw JSON bytes, including whitespace and UTF-8", async () => {
  const body = JSON.stringify({ ...contexts[0].envelope, note: "café ♞" });
  for (const altered of [
    body + "\n",
    body.replace("café", "cafe"),
    JSON.stringify(JSON.parse(body), null, 2),
  ]) {
    const app = harness();
    await error(
      await app.handler(request(altered, signed(body))),
      401,
      "unauthorized",
    );
    assert.equal(app.calls(), 0);
  }
  const app = harness({ keys: { active: "clé-synthétique-♞" } });
  assert.equal(
    (await app.handler(request(body, signed(body, "clé-synthétique-♞"))))
      .status,
    200,
  );
  assert.equal(app.calls(), 1);
});

for (const [name, headers] of [
  ["missing headers", {}],
  ["missing signature", { "x-dicechess-timestamp": String(timestamp) }],
  [
    "missing timestamp",
    { "x-dicechess-signature": signed(gameplay)["x-dicechess-signature"] },
  ],
  ["wrong key", signed(gameplay, "wrong-synthetic-key")],
  [
    "uppercase signature",
    {
      ...signed(gameplay),
      "x-dicechess-signature":
        signed(gameplay)["x-dicechess-signature"].toUpperCase(),
    },
  ],
  [
    "short signature",
    { ...signed(gameplay), "x-dicechess-signature": "a".repeat(63) },
  ],
  [
    "nonhex signature",
    { ...signed(gameplay), "x-dicechess-signature": "z".repeat(64) },
  ],
  ...[
    "+1756728000",
    "01756728000",
    "1756728000.0",
    "1.756728e9",
    "NaN",
    "9007199254740993",
    "1756728000,1756728000",
  ].map((stamp) => [
    `noncanonical timestamp ${stamp}`,
    signed(gameplay, active, stamp),
  ]),
]) {
  test(`authentication rejects ${name} before strategy dispatch`, async () => {
    const app = harness();
    await error(
      await app.handler(request(gameplay, headers)),
      401,
      "unauthorized",
    );
    assert.equal(app.calls(), 0);
  });
}

for (const delta of [-301, -300, 300, 301]) {
  test(`signature freshness boundary ${delta} seconds`, async () => {
    const app = harness();
    const response = await app.handler(
      request(gameplay, signed(gameplay, active, String(timestamp + delta))),
    );
    if (Math.abs(delta) <= 300) {
      assert.equal(response.status, 200);
      assert.equal(app.calls(), 1);
    } else {
      await error(response, 401, "unauthorized");
      assert.equal(app.calls(), 0);
    }
  });
}

test("legacy readiness is disabled by default even with a valid signature", async () => {
  const app = harness();
  const body = JSON.stringify({
    type: "verification",
    nonce: "readiness-probe",
  });
  await error(await app.handler(request(body)), 400, "unsupported_delivery");
  assert.equal(app.calls(), 0);
});

for (const key of [active, pending]) {
  test(`explicit legacy readiness accepts signed ${key === active ? "active" : "pending"} key without strategy`, async () => {
    const app = harness({ allowLegacyReadiness: true });
    const body = JSON.stringify({
      type: "verification",
      nonce: "readiness-probe",
    });
    const response = await app.handler(request(body, signed(body, key)));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { nonce: "readiness-probe" });
    assert.equal(app.calls(), 0);
  });
}

test("legacy opt-in never permits unsigned, wrong-key, or stale readiness", async () => {
  const body = JSON.stringify({
    type: "verification",
    nonce: "readiness-probe",
  });
  for (const headers of [
    {},
    signed(body, "wrong-key"),
    signed(body, active, String(timestamp - 301)),
  ]) {
    const app = harness({ allowLegacyReadiness: true });
    await error(await app.handler(request(body, headers)), 401, "unauthorized");
    assert.equal(app.calls(), 0);
  }
});

for (const version of [1, null, "2", 3]) {
  test(`explicit verification version ${JSON.stringify(version)} does not fall back to legacy`, async () => {
    const app = harness({ allowLegacyReadiness: true });
    const body = JSON.stringify({ ...JSON.parse(vectors[0].rawBody), version });
    await error(
      await app.handler(request(body, signed(body, pending))),
      400,
      "unsupported_delivery",
    );
    assert.equal(app.calls(), 0);
  });
}

for (const [name, change] of [
  ["missing nonce", { nonce: undefined }],
  ["short nonce", { nonce: "AA" }],
  ["padded nonce", { nonce: "AAECAwQFBgcICQoLDA0ODw==" }],
  ["noncanonical nonce trailing bits", { nonce: "AAECAwQFBgcICQoLDA0ODx" }],
  ["non-url alphabet", { nonce: "/".repeat(22) }],
  ["blank team", { bot: { team: " ", name: "bot" } }],
  ["blank name", { bot: { team: "team", name: "" } }],
  ["missing bot", { bot: undefined }],
  ["blank setupId", { setupId: " " }],
  ["missing revision", { revision: undefined }],
]) {
  test(`v2 rejects ${name} without generating a proof`, async () => {
    const app = harness();
    const body = JSON.stringify({
      ...JSON.parse(vectors[0].rawBody),
      ...change,
    });
    await error(
      await app.handler(request(body, signed(body, pending))),
      400,
      "invalid_request",
    );
    assert.equal(app.calls(), 0);
  });
}

test("body limit counts UTF-8 bytes, not JavaScript characters", async () => {
  const body = JSON.stringify({
    ...contexts[0].envelope,
    note: "♞".repeat(20),
  });
  const app = harness({ limits: { ...limits, maxBodyBytes: body.length } });
  await error(await app.handler(request(body)), 413, "invalid_request");
  assert.equal(app.calls(), 0);
});
