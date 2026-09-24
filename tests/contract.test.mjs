import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import vectors from "../fixtures/verification-v2.json" with { type: "json" };
import contexts from "../fixtures/contexts.json" with { type: "json" };
import fallback from "../fixtures/fallback.json" with { type: "json" };
import {
  ACTIVATION_PROOF_PREFIX,
  CONTRACT_DELIVERY_TYPES,
  PROTOCOL_REFERENCES,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  VERIFICATION_VERSION,
} from "../dist/index.js";

// Test-only crypto oracle, not runtime authentication or freshness validation.
const encoder = new TextEncoder();
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

test("built entry exports the pinned contract without advertising a handler", () => {
  assert.equal(SIGNATURE_HEADER, "x-dicechess-signature");
  assert.equal(TIMESTAMP_HEADER, "x-dicechess-timestamp");
  assert.equal(VERIFICATION_VERSION, 2);
  assert.deepEqual(CONTRACT_DELIVERY_TYPES, ["yourTurn", "drawDecision"]);
  assert(Object.isFrozen(CONTRACT_DELIVERY_TYPES));
  assert.match(PROTOCOL_REFERENCES.serverCommit, /^[a-f0-9]{40}$/);
  assert.match(PROTOCOL_REFERENCES.jvmCommit, /^[a-f0-9]{40}$/);
});

for (const vector of vectors) {
  test(`${vector.id}: exact request signature with UTF-8 secret`, async () => {
    assert.equal(
      await hmac(vector.secret, `${vector.timestamp}.${vector.rawBody}`),
      vector.signature,
    );
    assert.equal(
      createHmac("sha256", vector.secret)
        .update(`${vector.timestamp}.${vector.rawBody}`)
        .digest("hex"),
      vector.signature,
    );
    const revision = vector.id.startsWith("server")
      ? PROTOCOL_REFERENCES.serverCommit
      : PROTOCOL_REFERENCES.jvmCommit;
    assert(vector.source.includes(revision));
  });
  test(`${vector.id}: domain-separated proof and canonical nonce`, async () => {
    assert.equal(
      await hmac(vector.secret, ACTIVATION_PROOF_PREFIX + vector.rawBody),
      vector.proof,
    );
    assert.equal(
      createHmac("sha256", vector.secret)
        .update(ACTIVATION_PROOF_PREFIX + vector.rawBody)
        .digest("hex"),
      vector.proof,
    );
    assert.notEqual(vector.proof, vector.signature);
    const { nonce, version } = JSON.parse(vector.rawBody);
    assert.equal(version, VERIFICATION_VERSION);
    assert(!nonce.includes("="));
    const decoded = Buffer.from(nonce, "base64url");
    assert(decoded.byteLength >= 16);
    assert.equal(decoded.toString("base64url"), nonce);
  });
  test(`${vector.id}: changed bytes, timestamp, and key cannot reuse a signature`, async () => {
    for (const body of [
      vector.rawBody + "\n",
      JSON.stringify(JSON.parse(vector.rawBody), null, 2),
      vector.rawBody.replace("acme", "acmé"),
    ]) {
      assert.notEqual(
        await hmac(vector.secret, `${vector.timestamp}.${body}`),
        vector.signature,
      );
      assert.notEqual(
        await hmac(vector.secret, ACTIVATION_PROOF_PREFIX + body),
        vector.proof,
      );
    }
    assert.notEqual(
      await hmac(vector.secret, `${vector.timestamp + 1}.${vector.rawBody}`),
      vector.signature,
    );
    assert.notEqual(
      await hmac(
        "different-synthetic-key",
        `${vector.timestamp}.${vector.rawBody}`,
      ),
      vector.signature,
    );
  });
}

test("the two upstream vectors are intentionally distinct, not conflated", () => {
  assert.equal(vectors.length, 2);
  assert.notEqual(vectors[0].rawBody, vectors[1].rawBody);
  assert.notEqual(vectors[0].secret, vectors[1].secret);
});

// Fixture oracle only. The actual decoder/handler is a later milestone.
function fixtureContext(envelope) {
  const { gameId, seat, state } = envelope;
  assert.equal(seat, state.activeSeat);
  assert(Number.isSafeInteger(state.version));
  assert.equal(state.dicePending, envelope.type === "yourTurn");
  const clock =
    state.clocks === null
      ? null
      : {
          remainingMillis: state.clocks[seat === "White" ? "white" : "black"],
          opponentRemainingMillis:
            state.clocks[seat === "White" ? "black" : "white"],
          incrementMillis:
            state.timeControl?.Fischer?.incrementSeconds === undefined
              ? null
              : state.timeControl.Fischer.incrementSeconds * 1000,
        };
  const base = {
    gameId,
    seat,
    version: state.version,
    dfen: state.dfen,
    clock,
  };
  if (envelope.type === "drawDecision") {
    assert.equal(state.drawOffer.pending, true);
    assert.equal(state.dfen.split(" ").length, 6);
    return base;
  }
  return {
    ...base,
    legalMoves: state.legalMoves ?? null,
    mayOfferDraw: state.mayOfferDraw === true,
  };
}

for (const fixture of contexts) {
  test(`context fixture: ${fixture.id}`, () => {
    assert.deepEqual(fixtureContext(fixture.envelope), fixture.context);
  });
}

test("missing, null, and empty legal moves remain distinct on the wire", () => {
  const byId = Object.fromEntries(
    contexts.map((fixture) => [fixture.id, fixture]),
  );
  assert(
    !Object.hasOwn(
      byId["moves-unavailable-missing"].envelope.state,
      "legalMoves",
    ),
  );
  assert.equal(byId["moves-unavailable-null"].envelope.state.legalMoves, null);
  assert.deepEqual(byId["empty-root"].context.legalMoves, {});
  assert.notEqual(byId["empty-root"].context.legalMoves, null);
});

for (const fixture of fallback.cases) {
  test(`fallback fixture: ${fixture.id}`, () => {
    const { response } = fixture;
    const matches =
      response.version === fallback.origin.version &&
      response.dfen === fallback.origin.dfen &&
      response.dicePending === true;
    assert.equal(matches ? "accept" : "stale_context", fixture.expected);
  });
}

test("JS contract cannot silently accept unsafe Long versions", () => {
  const unsafe = JSON.parse('{"version":9007199254740993}').version;
  assert.equal(Number.isSafeInteger(unsafe), false);
  assert.equal(Number.isSafeInteger(Number.MAX_SAFE_INTEGER), true);
});

test("tree fixture preserves shorter leaves and never invents an empty turn", () => {
  const tree = { a1a2: {}, b1c3: { c3d5: { d5f6: {} } } };
  function paths(node, prefix = []) {
    const entries = Object.entries(node);
    if (entries.length === 0) return prefix.length ? [prefix] : [];
    return entries.flatMap(([move, child]) => paths(child, [...prefix, move]));
  }
  assert.deepEqual(paths(tree), [["a1a2"], ["b1c3", "c3d5", "d5f6"]]);
  assert.deepEqual(paths({}), []);
});
