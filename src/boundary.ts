import type { MoveTree, RuntimeErrorCode } from "./protocol.js";

export class Failure extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}
export function invalid(): never {
  throw new Failure("invalid_request", 400);
}
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid();
  return value as Record<string, unknown>;
}
export function nonblank(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") invalid();
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid();
  return value;
}
export function json(bytes: Uint8Array): Record<string, unknown> {
  try {
    return record(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        (_name: string, value: unknown, context?: { source?: string }) => {
          // Consumed numeric fields are canonical decimal integers. Do not accept
          // fractional literals that JSON.parse rounds to an apparently safe integer.
          if (
            typeof value === "number" &&
            !/^(0|[1-9]\d*)$/.test(context?.source ?? "")
          )
            return NaN;
          return value;
        },
      ),
    );
  } catch {
    return invalid();
  }
}
export async function readBytes(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        abort();
        throw new Failure("invalid_request", 413);
      }
      chunks.push(chunk.value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
export const uci = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
export function tree(
  value: unknown,
  maxNodes: number,
  maxDepth: number,
): MoveTree {
  let count = 0;
  function visit(input: unknown, depth: number): MoveTree {
    if (++count > maxNodes || depth > maxDepth) invalid();
    const object = record(input);
    const output: Record<string, MoveTree> = {};
    for (const [move, child] of Object.entries(object)) {
      if (!uci.test(move)) invalid();
      output[move] = visit(child, depth + 1);
    }
    return Object.freeze(output);
  }
  return visit(value, 0);
}
export const encoder = new TextEncoder();
export function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
export function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify", "sign"],
  );
}
export function framed(
  prefix: string,
  body: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const head = encoder.encode(prefix);
  const result = new Uint8Array(head.length + body.length);
  result.set(head);
  result.set(body, head.length);
  return result;
}
