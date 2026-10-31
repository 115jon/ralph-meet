import type { D1Database } from "@cloudflare/workers-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/lib/__fixtures__/yapper-catalog.sample.json";
import {
  CATALOG_NORMALIZER_VERSION,
  CatalogStorageError,
  CatalogFetchDeferredError,
  CatalogIngestConflictError,
  CatalogValidationError,
  INGEST_COOLDOWN_MS,
  INGEST_FALLBACK_WINDOW_MS,
  MANUAL_SYNC_COOLDOWN_MS,
  decodeCatalogPayload,
  encodeCatalogPayload,
  getCollectiblesCatalog,
  getCollectiblesIngestState,
  ingestCollectiblesCatalog,
  ingestRetryAfterMs,
  manualSyncRetryAfterMs,
  normalizeYapperCatalog,
  parseCollectiblesAdminIds,
  resetCollectiblesCatalogMemory,
  syncCollectiblesCatalog,
  validateNormalizedCatalog,
  type CollectiblesCatalog,
} from "@/lib/collectibles-catalog";

type CacheRow = {
  source: string;
  payload: string;
  etag: string | null;
  category_count: number;
  item_count: number;
  synced_at: string;
};

type StatusRow = Record<string, unknown>;

const STATUS_COLUMNS = [
  "source",
  "last_attempt_at",
  "last_success_at",
  "last_failure_at",
  "last_error",
  "last_outcome",
  "consecutive_failures",
  "item_count",
  "category_count",
  "counts_json",
  "last_trigger",
  "last_duration_ms",
];

// Fixture has 7 collections; production floors are sized for the full shop.
const SMALL = { validation: { minItems: 10, minCategories: 3 } } as const;

function createDatabase(
  initial: { row?: CacheRow | null; failStatusWrites?: boolean } = {},
) {
  let row: CacheRow | null = initial.row ?? null;
  const statuses = new Map<string, StatusRow>();
  const statements: string[] = [];

  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        async run() {
          return {};
        },
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM collectible_catalog_sync_status")) {
                return (statuses.get(String(values[0])) ?? null) as T | null;
              }
              return row as T | null;
            },
            async run() {
              if (sql.includes("INSERT INTO collectible_catalog_cache")) {
                row = {
                  source: String(values[0]),
                  payload: String(values[1]),
                  etag: values[2] == null ? null : String(values[2]),
                  category_count: Number(values[3]),
                  item_count: Number(values[4]),
                  synced_at: String(values[5]),
                };
              }
              if (sql.includes("UPDATE collectible_catalog_cache") && row) {
                row.etag = values[0] == null ? row.etag : String(values[0]);
                row.synced_at = String(values[1]);
              }
              if (sql.includes("INSERT INTO collectible_catalog_sync_status")) {
                if (initial.failStatusWrites) throw new Error("D1 busy");
                statuses.set(
                  String(values[0]),
                  Object.fromEntries(
                    STATUS_COLUMNS.map((column, index) => [
                      column,
                      values[index],
                    ]),
                  ),
                );
              }
              return {};
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    db,
    getRow: () => row,
    getStatus: () => statuses.get("discord-collectibles") ?? null,
    getIngestStatus: () => statuses.get("discord-collectibles:ingest") ?? null,
    countStatements: (fragment: string) =>
      statements.filter((sql) => sql.includes(fragment)).length,
  };
}

function okResponse(body: unknown, etag = "etag-1") {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { etag },
  });
}

function legacyRow(catalog: CollectiblesCatalog, syncedAt: string): CacheRow {
  return {
    source: "discord-collectibles",
    payload: JSON.stringify(catalog),
    etag: 'W/"old"',
    category_count: catalog.categories.length,
    item_count: catalog.items.length,
    synced_at: syncedAt,
  };
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function requestHeaders(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  if (!init) throw new Error(`Expected fetch call ${call} to carry options`);
  return init.headers as Record<string, string>;
}

beforeEach(() => {
  resetCollectiblesCatalogMemory();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeYapperCatalog", () => {
  const catalog = normalizeYapperCatalog(fixture);

  it("includes colour variants that only exist under product.variants", () => {
    const bones = catalog.items.find(
      (item) => item.name === "Jack Skellington (Bones)",
    );
    expect(bones).toMatchObject({
      kind: "avatar_decoration",
      skuId: "1559628807718051933",
      variantOf: "1559627983088783492",
      variantLabel: "Bones",
      variantColor: "#545b68",
    });
    const base = catalog.items.find(
      (item) => item.skuId === "1559627983088783492",
    );
    expect(base).toMatchObject({
      variantOf: "1559627983088783492",
      variantLabel: "Base",
    });
  });

  it("adds every variant SKU the fixture carries", () => {
    const variantSkus = new Set<string>();
    for (const category of fixture as any[]) {
      for (const product of category.products) {
        for (const variant of product.variants ?? []) {
          for (const item of variant.items ?? []) variantSkus.add(item.sku_id);
        }
      }
    }
    const skus = new Set(catalog.items.map((item) => item.skuId));
    expect(variantSkus.size).toBeGreaterThan(0);
    for (const sku of variantSkus) expect(skus.has(sku)).toBe(true);
  });

  it("keeps upstream collection order and fills the shop fields", () => {
    expect(catalog.categories.map((category) => category.name)).toEqual(
      (fixture as any[]).map((category) => category.name),
    );
    const [nightmare] = catalog.categories;
    expect(nightmare.heroBannerUrl).toMatch(/^https:\/\/cdn\.discordapp\.com/);
    expect(nightmare.heroLogoUrl).toBeTruthy();
    expect(nightmare.mobileBannerUrl).toBeTruthy();
    expect(nightmare.background).toBe(
      "linear-gradient(180deg, #2B2957 0%, #6C6773 100%)",
    );
    expect(nightmare.marketingTitle).toBe("The Pumpkin King has arrived!");
    expect(nightmare.summary).toBe("");
    const cauldron = catalog.categories.find(
      (category) => category.name === "Cauldron Chaos",
    );
    expect(cauldron?.unpublishedAt).toBe("2026-11-03T07:59:59+00:00");
  });

  it("covers every kind and stamps the normaliser version", () => {
    expect(catalog.normalizerVersion).toBe(CATALOG_NORMALIZER_VERSION);
    for (const count of Object.values(catalog.counts)) {
      expect(count).toBeGreaterThan(0);
    }
  });

  it("drops a hero background that is not a plain colour or gradient", () => {
    const [category] = structuredClone(fixture) as any[];
    category.assets.json.hero_banner_display_config.background_style =
      "url(https://evil.test/x.png)";
    expect(
      normalizeYapperCatalog([category]).categories[0].background,
    ).toBeUndefined();
  });
});

describe("validateNormalizedCatalog", () => {
  const good = normalizeYapperCatalog(fixture);

  it("rejects catalogs under the item and collection floors", () => {
    expect(() =>
      validateNormalizedCatalog(good, null, { minItems: 10_000 }),
    ).toThrow(CatalogValidationError);
    expect(() =>
      validateNormalizedCatalog(good, null, {
        minItems: 10,
        minCategories: 50,
      }),
    ).toThrow(/collections/);
  });

  it("rejects a kind collapsing to zero", () => {
    const next = {
      ...good,
      items: good.items.filter((item) => item.kind !== "profile_effect"),
      counts: { ...good.counts, profile_effect: 0 },
    };
    expect(() =>
      validateNormalizedCatalog(next, good, {
        minItems: 10,
        minCategories: 3,
        kindCollapseThreshold: 5,
      }),
    ).toThrow(/profile_effect/);
  });

  it("rejects a sharp shrink but accepts small churn", () => {
    const halved = {
      ...good,
      items: good.items.slice(0, good.items.length / 2),
    };
    expect(() =>
      validateNormalizedCatalog(halved, good, {
        minItems: 10,
        minCategories: 3,
        kindCollapseThreshold: 1000,
      }),
    ).toThrow(/shrank/);
    const trimmed = { ...good, items: good.items.slice(1) };
    expect(() =>
      validateNormalizedCatalog(trimmed, good, {
        minItems: 10,
        minCategories: 3,
      }),
    ).not.toThrow();
  });
});

describe("catalog payload encoding", () => {
  it("round-trips through gzip and still reads legacy plain JSON", async () => {
    const catalog = normalizeYapperCatalog(fixture);
    const encoded = await encodeCatalogPayload(catalog);
    expect(encoded.startsWith("gz1:")).toBe(true);
    expect(encoded.length).toBeLessThan(JSON.stringify(catalog).length / 3);
    await expect(decodeCatalogPayload(encoded)).resolves.toEqual(
      JSON.parse(JSON.stringify(catalog)),
    );
    await expect(
      decodeCatalogPayload(JSON.stringify({ version: 1 })),
    ).resolves.toEqual({ version: 1 });
  });
});

describe("syncCollectiblesCatalog", () => {
  it("stores a compressed snapshot and records success", async () => {
    const { db, getRow, getStatus } = createDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(okResponse(fixture)),
    );

    const catalog = await syncCollectiblesCatalog(db, {
      ...SMALL,
      trigger: "cron",
    });

    expect(getRow()?.payload.startsWith("gz1:")).toBe(true);
    expect(getRow()?.item_count).toBe(catalog.items.length);
    expect(catalog.sync).toMatchObject({
      lastOutcome: "updated",
      consecutiveFailures: 0,
    });
    expect(getStatus()).toMatchObject({
      last_outcome: "updated",
      last_trigger: "cron",
      consecutive_failures: 0,
      item_count: catalog.items.length,
    });
  });

  it("reuses the snapshot on a 304 and refreshes syncedAt", async () => {
    const { db, getRow, getStatus } = createDatabase();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse(fixture, "etag-1"))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await syncCollectiblesCatalog(db, SMALL);
    const firstSyncedAt = getRow()!.synced_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await syncCollectiblesCatalog(db, SMALL);

    expect(second.items).toEqual(first.items);
    expect(requestHeaders(fetchMock, 1)["If-None-Match"]).toBe("etag-1");
    expect(Date.parse(getRow()!.synced_at)).toBeGreaterThan(
      Date.parse(firstSyncedAt),
    );
    expect(getStatus()?.last_outcome).toBe("not_modified");
  });

  it("skips If-None-Match when the cache came from another normaliser", async () => {
    const legacy = {
      ...normalizeYapperCatalog(fixture),
      normalizerVersion: undefined,
    };
    const { db, getRow } = createDatabase({
      row: legacyRow(legacy, hoursAgo(1)),
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse(fixture, "etag-new"));
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await syncCollectiblesCatalog(db, SMALL);

    expect(requestHeaders(fetchMock, 0)["If-None-Match"]).toBeUndefined();
    expect(catalog.normalizerVersion).toBe(CATALOG_NORMALIZER_VERSION);
    expect(getRow()?.etag).toBe("etag-new");
  });

  it("keeps the last good catalog when upstream fails, and says why", async () => {
    const { db, getRow, getStatus } = createDatabase();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse(fixture, "etag-2"))
      .mockResolvedValueOnce(
        new Response("<html>blocked</html>", {
          status: 403,
          statusText: "Forbidden",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await syncCollectiblesCatalog(db, SMALL);
    const goodPayload = getRow()!.payload;
    await expect(syncCollectiblesCatalog(db, SMALL)).rejects.toThrow(
      "Yapper catalog fetch failed with 403 Forbidden: <html>blocked</html>",
    );

    expect(getRow()?.payload).toBe(goodPayload);
    expect(getRow()?.etag).toBe("etag-2");
    expect(getStatus()).toMatchObject({
      last_outcome: "failed",
      consecutive_failures: 1,
      last_error: expect.stringContaining("403"),
    });
    expect(getStatus()?.last_success_at).toBeTruthy();
  });

  it.each([
    ["an object", { error: "maintenance" }],
    ["an empty list", []],
  ])(
    "rejects %s from upstream and keeps the last good catalog",
    async (_, body) => {
      const { db, getRow, getStatus } = createDatabase();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(okResponse(fixture, "etag-3"))
        .mockResolvedValueOnce(okResponse(body, "etag-bad"));
      vi.stubGlobal("fetch", fetchMock);

      await syncCollectiblesCatalog(db, SMALL);
      const goodPayload = getRow()!.payload;
      await expect(syncCollectiblesCatalog(db, SMALL)).rejects.toBeInstanceOf(
        CatalogValidationError,
      );

      expect(getRow()?.payload).toBe(goodPayload);
      expect(getRow()?.etag).toBe("etag-3");
      expect(getStatus()).toMatchObject({
        last_outcome: "rejected",
        consecutive_failures: 1,
      });
    },
  );

  it("rejects a partial upstream that shrinks the catalog", async () => {
    const { db, getRow, getStatus } = createDatabase();
    const partial = (fixture as any[]).slice(0, 3);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse(fixture, "etag-4"))
      .mockResolvedValueOnce(okResponse(partial, "etag-partial"));
    vi.stubGlobal("fetch", fetchMock);

    await syncCollectiblesCatalog(db, SMALL);
    await expect(
      syncCollectiblesCatalog(db, {
        validation: { minItems: 1, minCategories: 1 },
      }),
    ).rejects.toThrow(/shrank|lost every/);
    expect(getRow()?.etag).toBe("etag-4");
    expect(getStatus()?.last_outcome).toBe("rejected");
  });

  it("refuses a payload over the D1 size cap", async () => {
    const { db, getRow, getStatus } = createDatabase();
    const random = new Uint8Array(1_600_000);
    for (let offset = 0; offset < random.length; offset += 65_536) {
      crypto.getRandomValues(random.subarray(offset, offset + 65_536));
    }
    const noise = Buffer.from(random).toString("base64");
    const huge = structuredClone(fixture) as any[];
    huge[0].products.push({
      sku_id: "noise-sku",
      name: "Noise",
      summary: noise,
      type: 0,
      items: [{ type: 0, sku_id: "noise-sku", asset: "a_noise" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(okResponse(huge)),
    );

    await expect(syncCollectiblesCatalog(db, SMALL)).rejects.toBeInstanceOf(
      CatalogStorageError,
    );
    expect(getRow()).toBeNull();
    expect(getStatus()).toMatchObject({
      last_outcome: "failed",
      last_error: expect.stringContaining("D1 safety cap"),
    });
  });

  it("resets the failure streak on the next success", async () => {
    const { db, getStatus } = createDatabase();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(okResponse(fixture));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncCollectiblesCatalog(db, SMALL)).rejects.toThrow();
    await expect(syncCollectiblesCatalog(db, SMALL)).rejects.toThrow();
    expect(getStatus()?.consecutive_failures).toBe(2);
    await syncCollectiblesCatalog(db, SMALL);
    expect(getStatus()).toMatchObject({
      consecutive_failures: 0,
      last_error: null,
      last_outcome: "updated",
    });
    expect(getStatus()?.last_failure_at).toBeTruthy();
  });

  it("does not fail the sync when the status write fails", async () => {
    const { db, getRow } = createDatabase({ failStatusWrites: true });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(okResponse(fixture)),
    );

    await expect(syncCollectiblesCatalog(db, SMALL)).resolves.toBeTruthy();
    expect(getRow()).not.toBeNull();
  });

  it("creates its tables once per isolate, not on every call", async () => {
    const { db, countStatements } = createDatabase();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(okResponse(fixture))
        .mockResolvedValue(new Response(null, { status: 304 })),
    );

    await syncCollectiblesCatalog(db, SMALL);
    await syncCollectiblesCatalog(db, SMALL);
    await syncCollectiblesCatalog(db, SMALL);
    expect(countStatements("CREATE TABLE IF NOT EXISTS")).toBe(2);
  });
});

describe("getCollectiblesCatalog", () => {
  it("serves a stale cache immediately and refreshes in the background", async () => {
    const cached = normalizeYapperCatalog(fixture);
    const { db } = createDatabase({ row: legacyRow(cached, hoursAgo(10)) });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValue(new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const waitUntil = vi.fn();

    const served = await getCollectiblesCatalog(db, { waitUntil });

    expect(served.stale).toBe(true);
    expect(served.items.length).toBe(cached.items.length);
    expect(served.sync).toEqual({ consecutiveFailures: 0 });
    expect(waitUntil).toHaveBeenCalledTimes(1);

    await getCollectiblesCatalog(db, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh cache without touching upstream", async () => {
    const cached = normalizeYapperCatalog(fixture);
    const { db } = createDatabase({ row: legacyRow(cached, hoursAgo(1)) });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const waitUntil = vi.fn();

    const served = await getCollectiblesCatalog(db, { waitUntil });

    expect(served.stale).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("flags a cache from an older normaliser as stale", async () => {
    const legacy = {
      ...normalizeYapperCatalog(fixture),
      normalizerVersion: undefined,
    };
    const { db } = createDatabase({ row: legacyRow(legacy, hoursAgo(1)) });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());

    const served = await getCollectiblesCatalog(db);
    expect(served.stale).toBe(true);
  });

  it("blocks on upstream only when nothing is cached", async () => {
    const { db } = createDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("down")),
    );

    await expect(getCollectiblesCatalog(db)).rejects.toThrow(
      "Unable to load collectibles catalog",
    );
  });
});

describe("manual sync guards", () => {
  it("parses the admin allowlist; unset means nobody", () => {
    expect(parseCollectiblesAdminIds(undefined).size).toBe(0);
    expect(parseCollectiblesAdminIds("")).toEqual(new Set());
    expect(parseCollectiblesAdminIds(" u1, u2 ,u3 ")).toEqual(
      new Set(["u1", "u2", "u3"]),
    );
  });

  it("enforces a cooldown from the last attempt", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(manualSyncRetryAfterMs({ consecutiveFailures: 0 }, now)).toBe(0);
    expect(
      manualSyncRetryAfterMs(
        {
          consecutiveFailures: 0,
          lastAttemptAt: new Date(now - 60_000).toISOString(),
        },
        now,
      ),
    ).toBe(MANUAL_SYNC_COOLDOWN_MS - 60_000);
    expect(
      manualSyncRetryAfterMs(
        {
          consecutiveFailures: 0,
          lastAttemptAt: new Date(
            now - MANUAL_SYNC_COOLDOWN_MS - 1,
          ).toISOString(),
        },
        now,
      ),
    ).toBe(0);
  });
});

describe("ingestCollectiblesCatalog", () => {
  const body = JSON.stringify(fixture);

  it("stores a pushed catalog through the cron path and records the ingest", async () => {
    const { db, getRow, getStatus, getIngestStatus } = createDatabase();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await ingestCollectiblesCatalog(
      db,
      { body, etag: 'W/"up-1"' },
      SMALL,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getRow()?.payload.startsWith("gz1:")).toBe(true);
    expect(getRow()?.etag).toBe('W/"up-1"');
    expect(getRow()?.item_count).toBe(catalog.items.length);
    expect(getStatus()).toMatchObject({
      last_outcome: "updated",
      last_trigger: "ingest",
      consecutive_failures: 0,
      item_count: catalog.items.length,
    });
    expect(getIngestStatus()).toMatchObject({
      last_outcome: "updated",
      last_attempt_at: expect.any(String),
      last_success_at: expect.any(String),
    });
    await expect(getCollectiblesIngestState(db)).resolves.toMatchObject({
      etag: 'W/"up-1"',
      syncedAt: getRow()?.synced_at,
      formatVersion: CATALOG_NORMALIZER_VERSION,
      lastUploadAt: getIngestStatus()?.last_attempt_at,
    });

    resetCollectiblesCatalogMemory();
    const served = await getCollectiblesCatalog(db);
    expect(served.items).toHaveLength(catalog.items.length);
    expect(served.stale).toBe(false);
  });

  it.each([
    ["invalid JSON", "<html>nope</html>"],
    ["an object", JSON.stringify({ error: "maintenance" })],
    ["a partial catalog", JSON.stringify((fixture as any[]).slice(0, 1))],
  ])("rejects %s and keeps the last good catalog", async (_, bad) => {
    const { db, getRow, getStatus, getIngestStatus } = createDatabase();
    await ingestCollectiblesCatalog(db, { body, etag: "good" }, SMALL);
    const goodPayload = getRow()!.payload;

    await expect(
      ingestCollectiblesCatalog(db, { body: bad, etag: "bad" }, SMALL),
    ).rejects.toBeInstanceOf(CatalogValidationError);

    expect(getRow()?.payload).toBe(goodPayload);
    expect(getRow()?.etag).toBe("good");
    expect(getStatus()).toMatchObject({
      last_outcome: "rejected",
      last_trigger: "ingest",
      consecutive_failures: 1,
    });
    expect(getIngestStatus()?.last_outcome).toBe("rejected");
  });

  it("refreshes syncedAt on a matching not-modified ping without counting as an upload", async () => {
    const { db, getRow, getStatus, getIngestStatus } = createDatabase();
    await ingestCollectiblesCatalog(db, { body, etag: "e1" }, SMALL);
    const firstSyncedAt = getRow()!.synced_at;
    const firstUploadAt = getIngestStatus()!.last_attempt_at;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await ingestCollectiblesCatalog(db, { notModified: true, etag: "e1" });

    expect(Date.parse(getRow()!.synced_at)).toBeGreaterThan(
      Date.parse(firstSyncedAt),
    );
    expect(getStatus()?.last_outcome).toBe("not_modified");
    expect(getIngestStatus()?.last_attempt_at).toBe(firstUploadAt);
  });

  it("refuses a not-modified ping for another ETag", async () => {
    const { db, getRow } = createDatabase();
    await ingestCollectiblesCatalog(db, { body, etag: "e1" }, SMALL);
    const syncedAt = getRow()!.synced_at;

    await expect(
      ingestCollectiblesCatalog(db, { notModified: true, etag: "e0" }),
    ).rejects.toBeInstanceOf(CatalogIngestConflictError);
    expect(getRow()?.synced_at).toBe(syncedAt);
  });

  it("rate-limits uploads from the last upload", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(ingestRetryAfterMs({ lastUploadAt: null }, now)).toBe(0);
    expect(
      ingestRetryAfterMs(
        { lastUploadAt: new Date(now - 60_000).toISOString() },
        now,
      ),
    ).toBe(INGEST_COOLDOWN_MS - 60_000);
  });

  it("hides the ETag when the stored catalog came from another normaliser", async () => {
    const legacy = {
      ...normalizeYapperCatalog(fixture),
      normalizerVersion: undefined,
    };
    const { db } = createDatabase({ row: legacyRow(legacy, hoursAgo(1)) });
    await expect(getCollectiblesIngestState(db)).resolves.toMatchObject({
      etag: null,
      formatVersion: CATALOG_NORMALIZER_VERSION,
    });
  });
});

describe("cron fallback while ingest keeps up", () => {
  const blocked = () =>
    new Response('{"status":403}', { status: 403, statusText: "Forbidden" });

  it("warns instead of recording a failure soon after an ingest", async () => {
    const { db, getStatus } = createDatabase();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(blocked()));
    await ingestCollectiblesCatalog(
      db,
      { body: JSON.stringify(fixture), etag: "e1" },
      SMALL,
    );

    await expect(
      syncCollectiblesCatalog(db, { ...SMALL, trigger: "cron" }),
    ).rejects.toBeInstanceOf(CatalogFetchDeferredError);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("403"));
    expect(getStatus()).toMatchObject({
      last_outcome: "updated",
      last_trigger: "ingest",
      consecutive_failures: 0,
    });
  });

  it("records the failure once the last ingest is older than the window", async () => {
    const { db, getStatus } = createDatabase();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(blocked()));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await ingestCollectiblesCatalog(
        db,
        { body: JSON.stringify(fixture), etag: "e1" },
        SMALL,
      );
      vi.setSystemTime(Date.now() + INGEST_FALLBACK_WINDOW_MS + 60_000);

      await expect(
        syncCollectiblesCatalog(db, { ...SMALL, trigger: "cron" }),
      ).rejects.toThrow("403");
    } finally {
      vi.useRealTimers();
    }
    expect(getStatus()).toMatchObject({
      last_outcome: "failed",
      last_trigger: "cron",
      consecutive_failures: 1,
    });
  });

  it("still records manual failures", async () => {
    const { db, getStatus } = createDatabase();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(blocked()));
    await ingestCollectiblesCatalog(
      db,
      { body: JSON.stringify(fixture), etag: "e1" },
      SMALL,
    );
    await expect(
      syncCollectiblesCatalog(db, { ...SMALL, trigger: "manual" }),
    ).rejects.toThrow("403");
    expect(getStatus()?.last_outcome).toBe("failed");
  });
});

describe("profile frame layer urls", () => {
  it("keys layer art by the frame item's sku, also inside bundles", () => {
    const catalog = normalizeYapperCatalog(fixture, "2026-10-22T00:00:00Z");
    const frames = catalog.items.filter(
      (item) => item.kind === "profile_frame",
    );
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      for (const layer of frame.frame?.layers ?? []) {
        expect(layer.src).toContain(
          `/collectibles-shop/${frame.skuId}/${layer.id}/static`,
        );
      }
    }
  });
});
