import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createNodeListener } from "../dist/node.js";
import { createWebhookHandler } from "../dist/index.js";
import { createHmac } from "node:crypto";

function boundedHandler() {
  return createWebhookHandler({
    keys: { active: "synthetic-key" },
    now: () => 1756728000000,
    strategy: { onTurn: () => assert.fail("invalid request reached strategy") },
    limits: {
      timeoutMs: 1000,
      maxBodyBytes: 64,
      maxTreeNodes: 100,
      maxTreeDepth: 8,
      maxConcurrentRequests: 16,
      maxCacheEntries: 32,
      cacheTtlMs: 1000,
    },
  });
}

test("Node adapter delivers core rejection responses without resetting the socket", async (t) => {
  const url = await serve(t, boundedHandler());
  for (const [body, signed, status, error] of [
    ["x".repeat(1024), true, 413, "invalid_request"],
    ["{", true, 400, "invalid_request"],
    ["{}", false, 401, "unauthorized"],
  ]) {
    const headers = signed
      ? {
          "x-dicechess-timestamp": "1756728000",
          "x-dicechess-signature": createHmac("sha256", "synthetic-key")
            .update("1756728000." + body)
            .digest("hex"),
        }
      : {};
    const response = await fetch(url, { method: "POST", body, headers });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  }
});

test(
  "Node adapter sends 413 before an oversized chunked upload finishes",
  { timeout: 5000 },
  async (t) => {
    const url = await serve(t, boundedHandler());
    const result = new Promise((resolve, reject) => {
      const client = httpRequest(url, { method: "POST" }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, body }),
        );
        response.on("error", reject);
      });
      t.after(() => client.destroy());
      client.on("error", reject);
      client.write("x".repeat(1024));
      // Intentionally leave the request open: the limit must reject immediately.
    });
    assert.deepEqual(await result, {
      status: 413,
      body: '{"error":"invalid_request"}',
    });
  },
);

async function serve(t, handler) {
  const server = createServer(createNodeListener(handler));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("Node adapter keeps a fixed origin for network-path and absolute targets", async (t) => {
  const url = await serve(t, async (request) => new Response(request.url));
  for (const [path, expected] of [
    [
      "//example.invalid/webhook?test=yes",
      "http://localhost//example.invalid/webhook?test=yes",
    ],
    [
      "http://example.invalid/webhook?test=yes",
      "http://localhost/webhook?test=yes",
    ],
  ]) {
    const actual = await new Promise((resolve, reject) => {
      const client = httpRequest(
        url,
        { path, headers: { host: "untrusted.invalid" } },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.once("end", () => resolve(body));
          response.once("error", reject);
        },
      );
      client.once("error", reject);
      client.end();
    });
    assert.equal(actual, expected);
  }
});

test(
  "Node adapter closes an unread upload after unexpected handler failure",
  { timeout: 5000 },
  async (t) => {
    const url = await serve(t, async () => {
      throw new Error("synthetic failure");
    });
    await new Promise((resolve, reject) => {
      const client = httpRequest(url, { method: "POST" }, (response) => {
        assert.equal(response.statusCode, 500);
        assert.equal(response.headers.connection, "close");
        response.resume();
        response.once("end", resolve);
        response.once("error", reject);
      });
      t.after(() => client.destroy());
      client.once("error", reject);
      client.write("unfinished upload");
    });
  },
);

test("Node adapter preserves raw UTF-8 bytes, headers, path and response", async (t) => {
  const raw = ' { "text": "♟️", "spacing":  1 }\n';
  const url = await serve(t, async (request) => {
    assert.equal(request.method, "POST");
    assert.equal(new URL(request.url).pathname, "/webhook");
    assert.equal(new URL(request.url).search, "?test=yes");
    assert.equal(request.headers.get("x-dicechess-signature"), "synthetic");
    assert.deepEqual(
      new Uint8Array(await request.arrayBuffer()),
      new TextEncoder().encode(raw),
    );
    const headers = new Headers({ "x-response": "preserved" });
    headers.append("set-cookie", "first=1; Path=/");
    headers.append("set-cookie", "second=2; Path=/");
    return new Response("response ♟", { status: 202, headers });
  });
  const response = await fetch(`${url}/webhook?test=yes`, {
    method: "POST",
    headers: { "x-dicechess-signature": "synthetic" },
    body: raw,
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-response"), "preserved");
  assert.deepEqual(response.headers.getSetCookie(), [
    "first=1; Path=/",
    "second=2; Path=/",
  ]);
  assert.equal(await response.text(), "response ♟");
});

test("Node adapter sanitizes unexpected handler exceptions", async (t) => {
  const url = await serve(t, async () => {
    throw new Error("sensitive synthetic exception detail");
  });
  const response = await fetch(url);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(await response.text(), '{"error":"internal_error"}');
});

test("Node adapter handles bodyless and HEAD responses", async (t) => {
  const url = await serve(t, async (request) =>
    request.method === "HEAD"
      ? new Response("not sent", { status: 200 })
      : new Response(null, { status: 204 }),
  );
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const empty = await fetch(url);
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
});

test(
  "Node adapter cancels strategy work when a client disconnects",
  { timeout: 5000 },
  async (t) => {
    let started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    let cancelled;
    const aborted = new Promise((resolve) => {
      cancelled = resolve;
    });
    const url = await serve(t, async (request) => {
      started();
      await new Promise((resolve) =>
        request.signal.addEventListener("abort", resolve, { once: true }),
      );
      cancelled();
      return new Response("must not be delivered");
    });
    const client = httpRequest(url);
    client.on("error", () => {});
    client.end();
    await entered;
    client.destroy();
    await aborted;
  },
);
