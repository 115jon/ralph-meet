import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";

import { syncCollectiblesCatalog } from "@/lib/collectibles-catalog";

type CacheRow = {
  source: string;
  payload: string;
  etag: string | null;
  category_count: number;
  item_count: number;
  synced_at: string;
};

function createDatabase() {
  let row: CacheRow | null = null;

  const db = {
    prepare(sql: string) {
      return {
        async run() {
          return {};
        },
        bind(...values: unknown[]) {
          return {
            async first<T>() {
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
              if (sql.includes("UPDATE collectible_catalog_cache")) {
                if (row) {
                  row.etag = values[0] == null ? row.etag : String(values[0]);
                  row.synced_at = String(values[1]);
                }
              }
              return {};
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, getRow: () => row };
}

function yapperPayload() {
  return [
    {
      sku_id: "category-1",
      name: "Featured",
      products: [
        {
          sku_id: "product-1",
          name: "Decoration",
          items: [
            {
              type: 0,
              sku_id: "item-1",
              asset: "a_item",
            },
          ],
        },
      ],
    },
  ];
}

describe("collectibles catalog sync", () => {
  it("reuses the Yapper snapshot on a 304 response", async () => {
    const { db } = createDatabase();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(yapperPayload()), {
          status: 200,
          headers: { etag: "etag-1" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await syncCollectiblesCatalog(db);
    const second = await syncCollectiblesCatalog(db);

    expect(first.source).toBe("yapper");
    expect(second.source).toBe("yapper");
    expect(second.items).toEqual(first.items);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      headers: expect.objectContaining({ "If-None-Match": "etag-1" }),
    });
  });

  it("does not replace the Yapper snapshot when the upstream fails", async () => {
    const { db, getRow } = createDatabase();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(yapperPayload()), {
          status: 200,
          headers: { etag: "etag-2" },
        }),
      )
      .mockRejectedValueOnce(new Error("Yapper unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await syncCollectiblesCatalog(db);
    await expect(syncCollectiblesCatalog(db)).rejects.toThrow(
      "Yapper unavailable",
    );

    expect(getRow()?.etag).toBe("etag-2");
  });
});
