import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  ingestCollectiblesCatalog: vi.fn(),
  getCollectiblesIngestState: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  getDB: () => ({}),
  getEnv: () => mocks.env,
}));

vi.mock("@/lib/collectibles-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/collectibles-catalog")>();
  return {
    ...actual,
    ingestCollectiblesCatalog: mocks.ingestCollectiblesCatalog,
    getCollectiblesIngestState: mocks.getCollectiblesIngestState,
  };
});

import {
  CatalogIngestConflictError,
  CatalogValidationError,
  MAX_INGEST_BODY_BYTES,
} from "@/lib/collectibles-catalog";

import { GET, POST } from "../collectibles/ingest";

const TOKEN = "t".repeat(43);
const URL = "https://meet.test/api/collectibles/ingest";

function headers(token: string | null, extra: Record<string, string> = {}) {
  return {
    ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    ...extra,
  };
}

function post(
  body: BodyInit | null,
  token: string | null = TOKEN,
  extra: Record<string, string> = {},
) {
  return POST({
    request: new Request(URL, {
      method: "POST",
      headers: headers(token, extra),
      body,
    }),
  });
}

function get(token: string | null = TOKEN) {
  return GET({ request: new Request(URL, { headers: headers(token) }) });
}

async function gzip(text: string) {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const catalog = {
  syncedAt: "2026-10-23T10:00:00.000Z",
  categories: [{}, {}],
  items: [{}, {}, {}],
  counts: { avatar_decoration: 3 },
  sync: { lastOutcome: "updated", consecutiveFailures: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.env = { COLLECTIBLES_INGEST_TOKEN: TOKEN };
  mocks.getCollectiblesIngestState.mockResolvedValue({
    etag: 'W/"abc"',
    syncedAt: "2026-10-23T09:00:00.000Z",
    formatVersion: 2,
    lastUploadAt: null,
  });
  mocks.ingestCollectiblesCatalog.mockResolvedValue(catalog);
});

describe("auth", () => {
  it("is disabled (503) when the secret is unset, even with a header", async () => {
    mocks.env = {};
    expect((await post("[]")).status).toBe(503);
    expect((await post("[]", "")).status).toBe(503);
    expect((await get()).status).toBe(503);
    expect(mocks.ingestCollectiblesCatalog).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["wrong", "x".repeat(43)],
    ["a prefix of the real", TOKEN.slice(0, 20)],
  ])("rejects a %s token with 401", async (_, token) => {
    const response = await post("[]", token);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect((await get(token)).status).toBe(401);
    expect(mocks.ingestCollectiblesCatalog).not.toHaveBeenCalled();
    expect(mocks.getCollectiblesIngestState).not.toHaveBeenCalled();
  });

  it("accepts the right token", async () => {
    expect((await post("[]")).status).toBe(200);
  });
});

describe("GET", () => {
  it("returns the stored etag, syncedAt and format version only", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      etag: 'W/"abc"',
      syncedAt: "2026-10-23T09:00:00.000Z",
      formatVersion: 2,
    });
  });
});

describe("POST", () => {
  it("passes the raw body and upstream ETag through and returns counts", async () => {
    const response = await post('[{"a":1}]', TOKEN, {
      "X-Upstream-ETag": 'W/"new"',
    });
    expect(response.status).toBe(200);
    expect(mocks.ingestCollectiblesCatalog).toHaveBeenCalledWith(
      expect.anything(),
      { body: '[{"a":1}]', etag: 'W/"new"' },
    );
    await expect(response.json()).resolves.toMatchObject({
      outcome: "updated",
      etag: 'W/"new"',
      categories: 2,
      items: 3,
    });
  });

  it("inflates a gzip body", async () => {
    const response = await post(await gzip('[{"z":2}]'), TOKEN, {
      "Content-Encoding": "gzip",
    });
    expect(response.status).toBe(200);
    expect(mocks.ingestCollectiblesCatalog).toHaveBeenCalledWith(
      expect.anything(),
      { body: '[{"z":2}]', etag: null },
    );
  });

  it("returns 422 with the validation reason", async () => {
    mocks.ingestCollectiblesCatalog.mockRejectedValue(
      new CatalogValidationError(
        "Upstream catalog shrank from 900 to 10 items",
      ),
    );
    const response = await post("[]");
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "COLLECTIBLES_INGEST_REJECTED",
      error: expect.stringContaining("shrank from 900 to 10"),
    });
  });

  it("returns 413 above the cap without ingesting", async () => {
    const big = new Uint8Array(MAX_INGEST_BODY_BYTES + 1).fill(32);
    expect((await post(big)).status).toBe(413);

    const bomb = await gzip(" ".repeat(MAX_INGEST_BODY_BYTES + 1));
    expect(
      (await post(bomb, TOKEN, { "Content-Encoding": "gzip" })).status,
    ).toBe(413);
    expect(mocks.ingestCollectiblesCatalog).not.toHaveBeenCalled();
  });

  it("allows one upload per cooldown (429)", async () => {
    mocks.getCollectiblesIngestState.mockResolvedValue({
      etag: null,
      syncedAt: null,
      formatVersion: 2,
      lastUploadAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const response = await post("[]");
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(200);
    expect(mocks.ingestCollectiblesCatalog).not.toHaveBeenCalled();
  });

  it("lets a not-modified ping through the cooldown", async () => {
    mocks.getCollectiblesIngestState.mockResolvedValue({
      etag: 'W/"abc"',
      syncedAt: null,
      formatVersion: 2,
      lastUploadAt: new Date().toISOString(),
    });
    const response = await post(null, TOKEN, {
      "X-Upstream-Not-Modified": "1",
      "X-Upstream-ETag": 'W/"abc"',
    });
    expect(response.status).toBe(200);
    expect(mocks.ingestCollectiblesCatalog).toHaveBeenCalledWith(
      expect.anything(),
      { notModified: true, etag: 'W/"abc"' },
    );
  });

  it("maps an ETag mismatch to 409 and a ping without ETag to 400", async () => {
    mocks.ingestCollectiblesCatalog.mockRejectedValue(
      new CatalogIngestConflictError("mismatch"),
    );
    expect(
      (
        await post(null, TOKEN, {
          "X-Upstream-Not-Modified": "1",
          "X-Upstream-ETag": "old",
        })
      ).status,
    ).toBe(409);
    expect(
      (await post(null, TOKEN, { "X-Upstream-Not-Modified": "1" })).status,
    ).toBe(400);
  });
});
