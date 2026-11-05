import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

function extractHeaders(rawHeaders: string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers.append(rawHeaders[index]!, rawHeaders[index + 1]!);
  }
  return headers;
}

function resolveRequestUrl(url: string | undefined): URL {
  const target = url ?? "/";
  const absolute = target.startsWith("/") ? undefined : new URL(target);
  if (absolute && !["http:", "https:"].includes(absolute.protocol))
    throw new TypeError("Unsupported HTTP request target");
  const path = absolute ? absolute.pathname + absolute.search : target;
  return new URL("http://localhost" + path);
}

function createBridgeStream(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  onClean: (fn: () => void) => void,
): ReadableStream<Uint8Array> {
  let cleanBody = () => {};
  onClean(() => cleanBody());
  return new ReadableStream<Uint8Array>(
    {
      start(stream) {
        const data = (chunk: Buffer) => {
          incoming.pause();
          stream.enqueue(chunk);
        };
        const end = () => {
          cleanBody();
          stream.close();
        };
        const error = () => {
          cleanBody();
          stream.error(new Error("Request stream failed"));
        };
        cleanBody = () => {
          incoming.off("data", data);
          incoming.off("end", end);
          incoming.off("error", error);
        };
        incoming.pause();
        incoming.on("data", data);
        incoming.once("end", end);
        incoming.once("error", error);
      },
      pull() {
        incoming.resume();
      },
      cancel() {
        incoming.pause();
        cleanBody();
        outgoing.shouldKeepAlive = false;
      },
    },
    { highWaterMark: 0 },
  );
}

async function sendResponse(
  response: Response,
  outgoing: ServerResponse,
  method: string,
): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") outgoing.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
  if (response.body === null || method === "HEAD") {
    await response.body?.cancel();
    outgoing.end();
  } else {
    // DOM and Node declarations differ for BYOB readers, but Node's Fetch
    // response body is the same web stream accepted by this bridge.
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream),
      outgoing,
    );
  }
}

function sendInternalError(outgoing: ServerResponse): void {
  if (outgoing.headersSent) {
    outgoing.destroy();
  } else {
    for (const name of outgoing.getHeaderNames()) outgoing.removeHeader(name);
    outgoing.writeHead(500, { "content-type": "application/json" });
    outgoing.end('{"error":"internal_error"}');
  }
}

/** Adapt a web-standard handler without starting a server or reading configuration. */
export function createNodeListener(
  handler: (request: Request) => Promise<Response>,
): (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void> {
  return async (incoming, outgoing) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => {
      if (!outgoing.writableFinished) abort();
    };
    incoming.on("aborted", abort);
    // A response can finish while the upload is still open. Retain this error
    // sink until IncomingMessage closes, including after body cancellation.
    incoming.on("error", abort);
    const requestClosed = () => incoming.off("error", abort);
    incoming.once("close", requestClosed);
    outgoing.on("close", onClose);
    let cleanBody = () => {};
    try {
      if (incoming.destroyed || outgoing.destroyed) abort();
      const headers = extractHeaders(incoming.rawHeaders);
      const method = incoming.method ?? "GET";
      const init: RequestInit & { duplex?: "half" } = {
        method,
        headers,
        signal: controller.signal,
      };
      if (method !== "GET" && method !== "HEAD") {
        // Cancelling Readable.toWeb(incoming) destroys the shared HTTP socket,
        // preventing core rejections (for example 413) from reaching the client.
        // This bridge pauses on every chunk and closes only after the response.
        init.body = createBridgeStream(incoming, outgoing, (fn) => {
          cleanBody = fn;
        });
        init.duplex = "half";
      }
      // Host headers are untrusted; routing uses the original path and query only.
      const request = new Request(resolveRequestUrl(incoming.url), init);
      const response = await handler(request);
      if (!incoming.readableEnded) outgoing.shouldKeepAlive = false;
      if (controller.signal.aborted || outgoing.destroyed) {
        await response.body?.cancel();
        return;
      }
      await sendResponse(response, outgoing, method);
    } catch {
      if (outgoing.destroyed) return;
      if (!incoming.readableEnded) outgoing.shouldKeepAlive = false;
      sendInternalError(outgoing);
    } finally {
      cleanBody();
      incoming.off("aborted", abort);
      if (incoming.closed) {
        incoming.off("error", abort);
        incoming.off("close", requestClosed);
      }
      outgoing.off("close", onClose);
    }
  };
}
