import type { D1Database } from "@cloudflare/workers-types";

export type CollectibleKind =
  | "avatar_decoration"
  | "profile_effect"
  | "nameplate"
  | "profile_frame";

export type CollectiblePrice = {
  amount: number;
  currency: string;
  exponent: number;
};

export type CollectibleFrameLayer = {
  id: string;
  src: string;
  type: string;
  order: "front" | "back";
  anchor: string;
  responsive: boolean;
};

export type CollectibleCatalogItem = {
  id: string;
  skuId: string;
  productId?: string;
  name: string;
  summary: string;
  label?: string;
  kind: CollectibleKind;
  source: "yapper" | "infinitay";
  categoryId: string;
  categoryName: string;
  productType: number;
  itemType: number;
  premiumType?: number;
  updatedAt?: string;
  previewUrl?: string;
  staticUrl?: string;
  animatedUrl?: string;
  asset?: string;
  palette?: string;
  price?: CollectiblePrice;
  nitroPrice?: CollectiblePrice;
  profileEffect?: {
    animationType?: number;
    thumbnailPreviewSrc?: string;
    reducedMotionSrc?: string;
    staticFrameSrc?: string;
    effects: Array<{
      src: string;
      loop?: boolean;
      duration?: number;
      start?: number;
      loopDelay?: number;
      zIndex?: number;
    }>;
  };
  frame?: {
    innerWidth: number;
    overflowTop: number;
    overflowBottom: number;
    overflowHorizontal: number;
    layers: CollectibleFrameLayer[];
  };
};

export type CollectibleCatalogCategory = {
  id: string;
  name: string;
  summary: string;
  bannerUrl?: string;
  logoUrl?: string;
  updatedAt?: string;
  itemIds: string[];
};

export type CollectiblesCatalog = {
  version: 1;
  source: "yapper" | "infinitay" | "cache";
  syncedAt: string;
  stale: boolean;
  categories: CollectibleCatalogCategory[];
  items: CollectibleCatalogItem[];
  counts: Record<CollectibleKind, number>;
};

type CatalogCacheRow = {
  source: string;
  payload: string;
  etag: string | null;
  category_count: number;
  item_count: number;
  synced_at: string;
};

const CACHE_SOURCE = "discord-collectibles";
const MAX_CACHE_AGE_MS = 1000 * 60 * 60 * 6;
const DISCORD_CDN = "https://cdn.discordapp.com";
const YAPPER_CATALOG_URL = "https://api.yapper.dev/v4/categories/catalog";
const INFINITAY_RAW_URL =
  "https://raw.githubusercontent.com/Infinitay/discord-collectibles-archive/main/discord-data/raw/collectibles-categories.json";

const YAPPER_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json",
  Origin: "https://yapper.shop",
  Referer: "https://yapper.shop/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "App-Properties":
    "eyJhcHBfdmVyc2lvbiI6IjcuNS44IiwiYXBwX3R5cGUiOiJTdGFibGUiLCJjbGllbnRfY29kZSI6ImRHOXdjeTh1ZVhad1lYUndaSE02TDJOa2NHNWxjaTR2TG1wemFIbGhaWEJvIn0=",
};

function defaultCounts(): Record<CollectibleKind, number> {
  return {
    avatar_decoration: 0,
    profile_effect: 0,
    nameplate: 0,
    profile_frame: 0,
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function kindFromItemType(type: unknown): CollectibleKind | null {
  switch (type) {
    case 0:
      return "avatar_decoration";
    case 1:
      return "profile_effect";
    case 2:
      return "nameplate";
    case 3:
      return "profile_frame";
    default:
      return null;
  }
}

function avatarDecorationUrl(asset: string, size = 240) {
  return `${DISCORD_CDN}/avatar-decoration-presets/${asset}.png?size=${size}&passthrough=true`;
}

function nameplateStaticUrl(asset: string) {
  return `${DISCORD_CDN}/assets/collectibles/${asset}static.png`;
}

function nameplateAnimatedUrl(asset: string) {
  return `${DISCORD_CDN}/assets/collectibles/${asset}asset.webm`;
}

function frameLayerUrl(productSkuId: string, layerId: string) {
  return `${DISCORD_CDN}/media/v1/collectibles-shop/${productSkuId}/${layerId}/static`;
}

function firstPrice(prices: unknown, key: "0" | "4"): CollectiblePrice | undefined {
  const price = asRecord(prices)[key];
  const countryPrices = asRecord(price).country_prices;
  const values = asArray(asRecord(countryPrices).prices);
  const first = asRecord(values[0]);
  const amount = first.amount;
  const exponent = first.exponent;
  const currency = first.currency;
  if (typeof amount !== "number" || typeof exponent !== "number" || typeof currency !== "string") {
    return undefined;
  }
  return { amount, exponent, currency };
}

function makeItemId(kind: CollectibleKind, skuId: string) {
  return `${kind}:${skuId}`;
}

function normalizeYapperProduct(
  category: Record<string, any>,
  product: Record<string, any>,
  item: Record<string, any>,
): CollectibleCatalogItem | null {
  const kind = kindFromItemType(item.type);
  const skuId = asString(item.sku_id) ?? asString(product.sku_id);
  if (!kind || !skuId) return null;

  const productSkuId = asString(product.sku_id) ?? skuId;
  const categoryName = asString(category.name) ?? "Uncategorized";
  const name = asString(item.title) ?? asString(product.name) ?? skuId;
  const label = asString(item.label) ?? asString(item.accessibilityLabel) ?? asString(item.description);
  const summary = asString(product.summary) ?? asString(item.description) ?? label ?? "";
  const previewAssets = asRecord(product.preview_assets);

  const normalized: CollectibleCatalogItem = {
    id: makeItemId(kind, skuId),
    skuId,
    productId: asString(product.product_id),
    name,
    summary,
    label,
    kind,
    source: "yapper",
    categoryId: asString(category.sku_id) ?? asString(category.store_listing_id) ?? categoryName,
    categoryName,
    productType: typeof product.type === "number" ? product.type : -1,
    itemType: typeof item.type === "number" ? item.type : -1,
    premiumType: typeof product.premium_type === "number" ? product.premium_type : undefined,
    updatedAt: asString(product.updated_at) ?? asString(category.updated_at),
    price: firstPrice(product.prices, "0"),
    nitroPrice: firstPrice(product.prices, "4"),
    previewUrl: asString(previewAssets.fg_static) ?? asString(previewAssets.bg_static),
  };

  if (kind === "avatar_decoration") {
    const asset = asString(item.asset);
    if (!asset) return null;
    normalized.asset = asset;
    normalized.staticUrl = avatarDecorationUrl(asset, 240);
    normalized.animatedUrl = avatarDecorationUrl(asset, 4096);
    normalized.previewUrl = normalized.previewUrl ?? normalized.staticUrl;
  }

  if (kind === "profile_effect") {
    const effects = asArray(item.effects)
      .map((effect) => {
        const row = asRecord(effect);
        const src = asString(row.src);
        if (!src) return null;
        return {
          src,
          loop: typeof row.loop === "boolean" ? row.loop : undefined,
          duration: typeof row.duration === "number" ? row.duration : undefined,
          start: typeof row.start === "number" ? row.start : undefined,
          loopDelay: typeof row.loopDelay === "number" ? row.loopDelay : undefined,
          zIndex: typeof row.zIndex === "number" ? row.zIndex : undefined,
        };
      })
      .filter((effect): effect is NonNullable<typeof effect> => Boolean(effect));

    normalized.profileEffect = {
      animationType: typeof item.animationType === "number" ? item.animationType : undefined,
      thumbnailPreviewSrc: asString(item.thumbnailPreviewSrc),
      reducedMotionSrc: asString(item.reducedMotionSrc),
      staticFrameSrc: asString(item.staticFrameSrc),
      effects,
    };
    normalized.staticUrl = normalized.profileEffect.staticFrameSrc ?? normalized.profileEffect.reducedMotionSrc;
    normalized.animatedUrl = effects[0]?.src;
    normalized.previewUrl =
      normalized.profileEffect.thumbnailPreviewSrc ??
      normalized.profileEffect.reducedMotionSrc ??
      normalized.profileEffect.staticFrameSrc ??
      effects[0]?.src ??
      normalized.previewUrl;
  }

  if (kind === "nameplate") {
    const asset = asString(item.asset);
    if (!asset) return null;
    normalized.asset = asset;
    normalized.palette = asString(item.palette);
    normalized.staticUrl = nameplateStaticUrl(asset);
    normalized.animatedUrl = nameplateAnimatedUrl(asset);
    normalized.previewUrl = normalized.staticUrl;
  }

  if (kind === "profile_frame") {
    const layers = asArray(item.layers)
      .map((layer) => {
        const row = asRecord(layer);
        const id = asString(row.id);
        if (!id) return null;
        return {
          id,
          src: frameLayerUrl(productSkuId, id),
          type: asString(row.type) ?? "staple",
          order: row.order === "back" ? "back" as const : "front" as const,
          anchor: asString(row.anchor) ?? "top",
          responsive: row.responsive === true,
        };
      })
      .filter((layer): layer is CollectibleFrameLayer => Boolean(layer));
    if (!layers.length) return null;

    normalized.frame = {
      innerWidth: typeof item.inner_width === "number" ? item.inner_width : 1200,
      overflowTop: typeof item.overflow_top === "number" ? item.overflow_top : 300,
      overflowBottom: typeof item.overflow_bottom === "number" ? item.overflow_bottom : 200,
      overflowHorizontal: typeof item.overflow_horizontal === "number" ? item.overflow_horizontal : 50,
      layers,
    };
    normalized.previewUrl = layers[0]?.src ?? normalized.previewUrl;
  }

  return normalized;
}

function shouldReplaceExisting(existing: CollectibleCatalogItem, next: CollectibleCatalogItem) {
  const existingIsBundle = existing.productType >= 1000;
  const nextIsSingle = next.productType < 1000;
  return existingIsBundle && nextIsSingle;
}

function normalizeYapperCatalog(raw: unknown, syncedAt = new Date().toISOString()): CollectiblesCatalog {
  const rawCategories = asArray(raw);
  const itemMap = new Map<string, CollectibleCatalogItem>();
  const categoryMap = new Map<string, CollectibleCatalogCategory>();

  for (const rawCategory of rawCategories) {
    const category = asRecord(rawCategory);
    const categoryId = asString(category.sku_id) ?? asString(category.store_listing_id) ?? asString(category.name) ?? "uncategorized";
    const categoryName = asString(category.name) ?? "Uncategorized";
    const assetUrls = asRecord(asRecord(category.assets).url);
    const itemIds = new Set<string>();

    for (const rawProduct of asArray(category.products)) {
      const product = asRecord(rawProduct);
      for (const rawItem of asArray(product.items)) {
        const item = normalizeYapperProduct(category, product, asRecord(rawItem));
        if (!item) continue;
        const existing = itemMap.get(item.id);
        if (!existing || shouldReplaceExisting(existing, item)) {
          itemMap.set(item.id, item);
        }
        itemIds.add(item.id);
      }
    }

    categoryMap.set(categoryId, {
      id: categoryId,
      name: categoryName,
      summary: asString(category.summary) ?? "",
      bannerUrl: asString(assetUrls.catalog_banner) ?? asString(assetUrls.hero_banner),
      logoUrl: asString(assetUrls.logo) ?? asString(assetUrls.hero_logo),
      updatedAt: asString(category.updated_at),
      itemIds: [...itemIds],
    });
  }

  const items = [...itemMap.values()].sort((a, b) => {
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind) return byKind;
    return a.name.localeCompare(b.name);
  });
  const counts = defaultCounts();
  for (const item of items) counts[item.kind] += 1;

  return {
    version: 1,
    source: "yapper",
    syncedAt,
    stale: false,
    categories: [...categoryMap.values()].filter((category) =>
      category.itemIds.some((id) => itemMap.has(id)),
    ),
    items,
    counts,
  };
}

function normalizeInfinitayCatalog(raw: unknown, syncedAt = new Date().toISOString()): CollectiblesCatalog {
  const rawCategories = asArray(raw);
  const itemMap = new Map<string, CollectibleCatalogItem>();
  const categories: CollectibleCatalogCategory[] = [];

  for (const rawCategory of rawCategories) {
    const category = asRecord(rawCategory);
    const categoryId = asString(category.sku_id) ?? asString(category.store_listing_id) ?? asString(category.name) ?? "uncategorized";
    const categoryName = asString(category.name) ?? "Uncategorized";
    const itemIds = new Set<string>();

    for (const rawProduct of asArray(category.products)) {
      const product = asRecord(rawProduct);
      for (const rawItem of asArray(product.items)) {
        const item = asRecord(rawItem);
        const kind = kindFromItemType(item.type);
        const skuId = asString(item.sku_id) ?? asString(product.sku_id);
        if (!kind || !skuId) continue;

        const asset = asString(item.asset);
        const normalized: CollectibleCatalogItem = {
          id: makeItemId(kind, skuId),
          skuId,
          name: asString(product.name) ?? skuId,
          summary: asString(product.summary) ?? asString(item.label) ?? "",
          label: asString(item.label),
          kind,
          source: "infinitay",
          categoryId,
          categoryName,
          productType: typeof product.type === "number" ? product.type : -1,
          itemType: typeof item.type === "number" ? item.type : -1,
          premiumType: typeof product.premium_type === "number" ? product.premium_type : undefined,
          price: firstPrice(product.prices, "0"),
          nitroPrice: firstPrice(product.prices, "4"),
          asset,
          staticUrl: kind === "avatar_decoration" && asset ? avatarDecorationUrl(asset, 240) : undefined,
          animatedUrl: kind === "avatar_decoration" && asset ? avatarDecorationUrl(asset, 4096) : undefined,
          previewUrl: kind === "avatar_decoration" && asset ? avatarDecorationUrl(asset, 240) : undefined,
        };
        itemMap.set(normalized.id, normalized);
        itemIds.add(normalized.id);
      }
    }

    categories.push({
      id: categoryId,
      name: categoryName,
      summary: asString(category.summary) ?? "",
      bannerUrl: asString(category.banner),
      updatedAt: asString(category.updated_at),
      itemIds: [...itemIds],
    });
  }

  const items = [...itemMap.values()];
  const counts = defaultCounts();
  for (const item of items) counts[item.kind] += 1;

  return {
    version: 1,
    source: "infinitay",
    syncedAt,
    stale: false,
    categories: categories.filter((category) => category.itemIds.length > 0),
    items,
    counts,
  };
}

async function ensureCatalogCacheTable(db: D1Database) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS collectible_catalog_cache (
      source TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      etag TEXT,
      category_count INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL
    )`,
  ).run();
}

async function readCatalogCache(db: D1Database): Promise<CatalogCacheRow | null> {
  await ensureCatalogCacheTable(db);
  return db.prepare(
    `SELECT source, payload, etag, category_count, item_count, synced_at
     FROM collectible_catalog_cache
     WHERE source = ?`,
  ).bind(CACHE_SOURCE).first<CatalogCacheRow>();
}

async function writeCatalogCache(db: D1Database, catalog: CollectiblesCatalog, etag?: string | null) {
  await ensureCatalogCacheTable(db);
  await db.prepare(
    `INSERT INTO collectible_catalog_cache (source, payload, etag, category_count, item_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       payload = excluded.payload,
       etag = excluded.etag,
       category_count = excluded.category_count,
       item_count = excluded.item_count,
       synced_at = excluded.synced_at`,
  ).bind(
    CACHE_SOURCE,
    JSON.stringify(catalog),
    etag ?? null,
    catalog.categories.length,
    catalog.items.length,
    catalog.syncedAt,
  ).run();
}

function parseCachedCatalog(row: CatalogCacheRow): CollectiblesCatalog | null {
  try {
    const parsed = JSON.parse(row.payload) as CollectiblesCatalog;
    return {
      ...parsed,
      source: parsed.source ?? "cache",
      stale: Date.now() - Date.parse(row.synced_at) > MAX_CACHE_AGE_MS,
    };
  } catch {
    return null;
  }
}

async function fetchYapperCatalog(): Promise<{ catalog: CollectiblesCatalog; etag: string | null }> {
  const response = await fetch(YAPPER_CATALOG_URL, {
    headers: YAPPER_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`Yapper catalog fetch failed with ${response.status}`);
  }
  const raw = await response.json();
  return {
    catalog: normalizeYapperCatalog(raw),
    etag: response.headers.get("etag"),
  };
}

async function fetchInfinitayCatalog(): Promise<CollectiblesCatalog> {
  const response = await fetch(INFINITAY_RAW_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": YAPPER_HEADERS["User-Agent"],
    },
  });
  if (!response.ok) {
    throw new Error(`Infinitay catalog fetch failed with ${response.status}`);
  }
  return normalizeInfinitayCatalog(await response.json());
}

export async function syncCollectiblesCatalog(db: D1Database): Promise<CollectiblesCatalog> {
  try {
    const { catalog, etag } = await fetchYapperCatalog();
    await writeCatalogCache(db, catalog, etag);
    return catalog;
  } catch {
    const fallback = await fetchInfinitayCatalog();
    await writeCatalogCache(db, fallback, null);
    return {
      ...fallback,
      stale: false,
      source: "infinitay",
    };
  }
}

export async function getCollectiblesCatalog(
  db: D1Database,
  options: { forceRefresh?: boolean } = {},
): Promise<CollectiblesCatalog> {
  const cachedRow = await readCatalogCache(db);
  const cached = cachedRow ? parseCachedCatalog(cachedRow) : null;
  const isFresh = cachedRow
    ? Date.now() - Date.parse(cachedRow.synced_at) <= MAX_CACHE_AGE_MS
    : false;

  if (cached && isFresh && !options.forceRefresh) {
    return { ...cached, stale: false };
  }

  try {
    return await syncCollectiblesCatalog(db);
  } catch {
    if (cached) return { ...cached, stale: true };
    throw new Error("Unable to load collectibles catalog");
  }
}

export function findCollectibleItem(catalog: CollectiblesCatalog, skuIdOrId: string) {
  return catalog.items.find((item) => item.id === skuIdOrId || item.skuId === skuIdOrId) ?? null;
}
