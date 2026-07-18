import { describe, it, expect, vi, afterEach } from "vitest";
import {
  safeFetch,
  readTextCapped,
  readJsonCapped,
  ResponseTooLargeError,
  DEFAULT_FETCH_TIMEOUT_MS,
} from "../safe-fetch";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("safeFetch", () => {
  it("passes a timeout signal to fetch and preserves init", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    await safeFetch("https://example.com", {
      method: "POST",
      headers: { "x-test": "1" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-test"]).toBe("1");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });

  it("combines a caller signal with the timeout signal", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    const controller = new AbortController();
    await safeFetch("https://example.com", { signal: controller.signal });

    const [, init] = spy.mock.calls[0];
    const signal = init?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    // Aborting the caller signal should abort the combined signal.
    controller.abort(new Error("caller cancelled"));
    expect(signal.aborted).toBe(true);
  });

  it("uses the default timeout", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

function streamResponse(bytes: Uint8Array, headers?: Record<string, string>) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Emit in small chunks to exercise the incremental cap check.
      const chunkSize = 64;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

describe("readTextCapped", () => {
  it("reads a normal body fully", async () => {
    const text = "hello world";
    const res = streamResponse(new TextEncoder().encode(text));
    await expect(readTextCapped(res)).resolves.toBe(text);
  });

  it("rejects when Content-Length exceeds the cap", async () => {
    const res = new Response("x", {
      headers: { "content-length": String(999_999_999) },
    });
    await expect(readTextCapped(res, 1024)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("rejects when the streamed body exceeds the cap without Content-Length", async () => {
    const big = new Uint8Array(4096).fill(65);
    const res = streamResponse(big);
    await expect(readTextCapped(res, 1024)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("returns empty string for a null body", async () => {
    const res = new Response(null);
    await expect(readTextCapped(res)).resolves.toBe("");
  });
});

describe("readJsonCapped", () => {
  it("parses JSON within the cap", async () => {
    const payload = { a: 1, b: "two" };
    const res = streamResponse(
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    await expect(readJsonCapped(res)).resolves.toEqual(payload);
  });

  it("propagates the cap to the underlying text read", async () => {
    const big = new Uint8Array(4096).fill(123);
    const res = streamResponse(big);
    await expect(readJsonCapped(res, 1024)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });
});
