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

export type CollectibleProfileEffectLayer = {
  src: string;
  loop?: boolean;
  duration?: number;
  start?: number;
  loopDelay?: number;
  zIndex?: number;
  width?: number;
  height?: number;
  position?: {
    x: number;
    y: number;
  };
  randomizedSources?: Array<{
    src: string;
  }>;
};

export type CollectibleCatalogItem = {
  id: string;
  skuId: string;
  productId?: string;
  name: string;
  summary: string;
  label?: string;
  kind: CollectibleKind;
  source: "yapper";
  categoryId: string;
  categoryName: string;
  productIds?: string[];
  productType: number;
  itemType: number;
  premiumType?: number;
  updatedAt?: string;
  previewUrl?: string;
  previewAssets?: {
    fg_static?: string;
    bg_static?: string;
    fg_animated?: string;
    bg_animated?: string;
    lottie_preview?: string;
    static_preview?: string;
  };
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
    effects: CollectibleProfileEffectLayer[];
  };
  /** Base SKU of the colour-variant family this item belongs to (upstream `base_variant_sku_id`). */
  variantOf?: string;
  /** Upstream `variant_label`, e.g. "Base", "Bones". */
  variantLabel?: string;
  /** Upstream `variant_value`, a swatch colour like "#d1d3e0". */
  variantColor?: string;
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
  heroBannerUrl?: string;
  heroLogoUrl?: string;
  mobileBannerUrl?: string;
  featuredBlockUrl?: string;
  /** CSS background from upstream `hero_banner_display_config.background_style`. */
  background?: string;
  /** When the collection leaves the source shop (may be in the future). */
  unpublishedAt?: string;
  marketingTitle?: string;
  marketingBody?: string;
  updatedAt?: string;
  itemIds: string[];
};

export type CollectiblesSyncOutcome =
  | "updated"
  | "not_modified"
  | "rejected"
  | "failed";

export type CollectiblesSyncStatus = {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  lastOutcome?: CollectiblesSyncOutcome;
  consecutiveFailures: number;
};

export type CollectiblesCatalog = {
  version: 1;
  source: "yapper";
  syncedAt: string;
  stale: boolean;
  categories: CollectibleCatalogCategory[];
  items: CollectibleCatalogItem[];
  counts: Record<CollectibleKind, number>;
  /** Bumped when normalisation changes so a 304 cannot pin an old shape. */
  normalizerVersion?: number;
  sync?: CollectiblesSyncStatus;
};

type CatalogCacheRow = {
  source: string;
  payload: string;
  etag: string | null;
  category_count: number;
  item_count: number;
  synced_at: string;
};

type SyncStatusRow = {
  source: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  last_outcome: string | null;
  consecutive_failures: number | null;
  item_count: number | null;
  category_count: number | null;
  counts_json: string | null;
  last_trigger: string | null;
  last_duration_ms: number | null;
};

type MemoryCatalogEntry = {
  catalog: CollectiblesCatalog;
  etag: string | null;
  loadedAtMs: number;
};

type VariantMeta = {
  variantOf: string;
  variantLabel?: string;
  variantColor?: string;
};

export type CollectiblesSyncTrigger = "cron" | "manual" | "request" | "ingest";

export type CatalogValidationOptions = {
  minItems?: number;
  minCategories?: number;
  /** Largest allowed drop in item count vs the last good catalog (0..1). */
  maxShrinkRatio?: number;
  /** A kind that had more than this many items may not drop to zero. */
  kindCollapseThreshold?: number;
};

export type SyncCollectiblesOptions = {
  trigger?: CollectiblesSyncTrigger;
  validation?: CatalogValidationOptions;
};

/**
 * Bump whenever normalisation output changes. A cached catalog with another
 * version is treated as stale and refetched without If-None-Match, so a 304
 * can never pin the old shape after a deploy.
 */
export const CATALOG_NORMALIZER_VERSION = 3;
/** Dedicated hourly cron for the catalog (wrangler.toml [triggers]). */
export const COLLECTIBLES_SYNC_CRON = "17 * * * *";
/** Stale once several hourly runs in a row have been missed or failed. */
export const CATALOG_STALE_AFTER_MS = 1000 * 60 * 60 * 4;
/** Minimum gap between request-triggered background refreshes. */
export const REQUEST_REFRESH_COOLDOWN_MS = 1000 * 60 * 10;
/** Minimum gap between manual (admin) syncs, measured from the last attempt. */
export const MANUAL_SYNC_COOLDOWN_MS = 1000 * 60 * 5;
/** D1 caps a row/string at 2,000,000 bytes; keep headroom. */
export const MAX_ENCODED_PAYLOAD_BYTES = 1_800_000;
/** Minimum gap between ingest uploads (a not-modified ping is free). */
export const INGEST_COOLDOWN_MS = 1000 * 60 * 5;
/** A cron/request fetch failure is only a warning this soon after an ingest. */
export const INGEST_FALLBACK_WINDOW_MS = 1000 * 60 * 60 * 2;
/** Cap on an uploaded (decompressed) upstream body; the real one is ~3.5 MB. */
export const MAX_INGEST_BODY_BYTES = 16 * 1024 * 1024;
export const DEFAULT_CATALOG_VALIDATION: Required<CatalogValidationOptions> = {
  minItems: 100,
  minCategories: 5,
  maxShrinkRatio: 0.4,
  kindCollapseThreshold: 20,
};

const CACHE_SOURCE = "discord-collectibles";
/**
 * Second status row, written only by ingests. last_attempt_at is the last
 * upload (rate limit); last_success_at is the last good ingest, upload or
 * not-modified ping (cron fallback window).
 */
const INGEST_STATUS_SOURCE = "discord-collectibles:ingest";
const GZIP_PREFIX = "gz1:";
const MEMORY_RECHECK_MS = 1000 * 60 * 5;
const MAX_ERROR_LENGTH = 500;
const UPSTREAM_TIMEOUT_MS = 25_000;
const DISCORD_CDN = "https://cdn.discordapp.com";
const YAPPER_CATALOG_URL = "https://api.yapper.dev/v4/categories/catalog";

let memoryCatalogEntry: MemoryCatalogEntry | null = null;
let memorySyncStatus: CollectiblesSyncStatus | null = null;
let inFlightCatalogSync: Promise<CollectiblesCatalog> | null = null;
let lastRequestRefreshAtMs = 0;
let readyTables = new WeakMap<D1Database, Promise<void>>();

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

export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogValidationError";
  }
}

export class CatalogStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogStorageError";
  }
}

/** A not-modified ingest whose ETag is not the one we hold. */
export class CatalogIngestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogIngestConflictError";
  }
}

/**
 * A cron/request upstream fetch failed while a recent ingest keeps the
 * catalog current. Logged as a warning and not recorded as a failure.
 */
export class CatalogFetchDeferredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogFetchDeferredError";
  }
}

/** Test hook: drop per-isolate memory (catalog, status, table checks). */
export function resetCollectiblesCatalogMemory() {
  memoryCatalogEntry = null;
  memorySyncStatus = null;
  inFlightCatalogSync = null;
  lastRequestRefreshAtMs = 0;
  readyTables = new WeakMap();
}

function defaultCounts(): Record<CollectibleKind, number> {
  return {
    avatar_decoration: 0,
    profile_effect: 0,
    nameplate: 0,
    profile_frame: 0,
  };
}

function defaultSyncStatus(): CollectiblesSyncStatus {
  return { consecutiveFailures: 0 };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asSwatch(value: unknown): string | undefined {
  const raw = asString(value)?.trim();
  return raw && /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : undefined;
}

/** Only colours and gradients; never url(), expressions or other CSS. */
function asCssBackground(value: unknown): string | undefined {
  const raw = asString(value)?.trim();
  if (!raw || raw.length > 300) return undefined;
  if (/url\s*\(|expression|[;{}<>"'\\]/i.test(raw)) return undefined;
  return /^[a-z0-9#%(),.\s-]+$/i.test(raw) ? raw : undefined;
}

/** Error text for logs and the status row (Error objects log without it). */
export function describeError(error: unknown): string {
  const message =
    error instanceof Error
      ? `${error.name === "Error" ? "" : `${error.name}: `}${error.message}`
      : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
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

/** Layer art is keyed by the frame item's sku, not the bundle's (404). */
function frameLayerUrl(frameSkuId: string, layerId: string) {
  return `${DISCORD_CDN}/media/v1/collectibles-shop/${frameSkuId}/${layerId}/static`;
}

function firstPrice(
  prices: unknown,
  key: "0" | "4",
): CollectiblePrice | undefined {
  const price = asRecord(prices)[key];
  const countryPrices = asRecord(price).country_prices;
  const values = asArray(asRecord(countryPrices).prices);
  const first = asRecord(values[0]);
  const amount = first.amount;
  const exponent = first.exponent;
  const currency = first.currency;
  if (
    typeof amount !== "number" ||
    typeof exponent !== "number" ||
    typeof currency !== "string"
  ) {
    return undefined;
  }
  return { amount, exponent, currency };
}

function makeItemId(kind: CollectibleKind, skuId: string) {
  return `${kind}:${skuId}`;
}

function variantMetaFrom(record: Record<string, any>): VariantMeta | undefined {
  const variantOf = asString(record.base_variant_sku_id);
  if (!variantOf) return undefined;
  return {
    variantOf,
    variantLabel: asString(record.variant_label),
    variantColor: asSwatch(record.variant_value),
  };
}

function normalizeYapperProduct(
  category: Record<string, any>,
  product: Record<string, any>,
  item: Record<string, any>,
  variant?: VariantMeta,
): CollectibleCatalogItem | null {
  const kind = kindFromItemType(item.type);
  const skuId = asString(item.sku_id) ?? asString(product.sku_id);
  if (!kind || !skuId) return null;

  const categoryName = asString(category.name) ?? "Uncategorized";
  const name = asString(item.title) ?? asString(product.name) ?? skuId;
  const label =
    asString(item.label) ??
    asString(item.accessibilityLabel) ??
    asString(item.description);
  const summary =
    asString(product.summary) ?? asString(item.description) ?? label ?? "";
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
    categoryId:
      asString(category.sku_id) ??
      asString(category.store_listing_id) ??
      categoryName,
    categoryName,
    productType: typeof product.type === "number" ? product.type : -1,
    itemType: typeof item.type === "number" ? item.type : -1,
    premiumType:
      typeof product.premium_type === "number"
        ? product.premium_type
        : undefined,
    updatedAt: asString(product.updated_at) ?? asString(category.updated_at),
    price: firstPrice(product.prices, "0"),
    nitroPrice: firstPrice(product.prices, "4"),
    previewUrl:
      asString(previewAssets.fg_static) ?? asString(previewAssets.bg_static),
    previewAssets: {
      fg_static: asString(previewAssets.fg_static),
      bg_static: asString(previewAssets.bg_static),
      fg_animated: asString(previewAssets.fg_animated),
      bg_animated: asString(previewAssets.bg_animated),
      lottie_preview: asString(previewAssets.lottie_preview),
      static_preview: asString(previewAssets.static_preview),
    },
  };

  if (variant) {
    normalized.variantOf = variant.variantOf;
    if (variant.variantLabel) normalized.variantLabel = variant.variantLabel;
    if (variant.variantColor) normalized.variantColor = variant.variantColor;
  }

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
        const randomizedSources = asArray(row.randomizedSources)
          .map((source) => {
            const entry = asRecord(source);
            const src = asString(entry.src);
            return src ? { src } : null;
          })
          .filter((source): source is { src: string } => Boolean(source));
        const src = asString(row.src) ?? randomizedSources[0]?.src;
        if (!src) return null;
        return {
          src,
          loop: typeof row.loop === "boolean" ? row.loop : undefined,
          duration: asNumber(row.duration),
          start: asNumber(row.start),
          loopDelay: asNumber(row.loopDelay),
          zIndex: asNumber(row.zIndex),
          width: asNumber(row.width),
          height: asNumber(row.height),
          position:
            row.position && typeof row.position === "object"
              ? (() => {
                  const position = asRecord(row.position);
                  const x = asNumber(position.x);
                  const y = asNumber(position.y);
                  if (x == null || y == null) return undefined;
                  return { x, y };
                })()
              : undefined,
          randomizedSources: randomizedSources.length
            ? randomizedSources
            : undefined,
        };
      })
      .filter((effect): effect is NonNullable<typeof effect> =>
        Boolean(effect),
      );

    normalized.profileEffect = {
      animationType:
        typeof item.animationType === "number" ? item.animationType : undefined,
      thumbnailPreviewSrc: asString(item.thumbnailPreviewSrc),
      reducedMotionSrc: asString(item.reducedMotionSrc),
      staticFrameSrc: asString(item.staticFrameSrc),
      effects,
    };
    normalized.staticUrl =
      normalized.profileEffect.staticFrameSrc ??
      normalized.profileEffect.reducedMotionSrc;
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
          src: frameLayerUrl(skuId, id),
          type: asString(row.type) ?? "staple",
          order: row.order === "back" ? ("back" as const) : ("front" as const),
          anchor: asString(row.anchor) ?? "top",
          responsive: row.responsive === true,
        };
      })
      .filter((layer): layer is CollectibleFrameLayer => Boolean(layer));
    if (!layers.length) return null;

    normalized.frame = {
      innerWidth:
        typeof item.inner_width === "number" ? item.inner_width : 1200,
      overflowTop:
        typeof item.overflow_top === "number" ? item.overflow_top : 300,
      overflowBottom:
        typeof item.overflow_bottom === "number" ? item.overflow_bottom : 200,
      overflowHorizontal:
        typeof item.overflow_horizontal === "number"
          ? item.overflow_horizontal
          : 50,
      layers,
    };
    normalized.previewUrl = layers[0]?.src ?? normalized.previewUrl;
  }

  return normalized;
}

function shouldReplaceExisting(
  existing: CollectibleCatalogItem,
  next: CollectibleCatalogItem,
) {
  const existingIsBundle = existing.productType >= 1000;
  const nextIsSingle = next.productType < 1000;
  return existingIsBundle && nextIsSingle;
}

function pickVariantFields(item: CollectibleCatalogItem) {
  return {
    variantOf: item.variantOf,
    variantLabel: item.variantLabel,
    variantColor: item.variantColor,
  };
}

function mergeVariantFields(
  target: CollectibleCatalogItem,
  source: ReturnType<typeof pickVariantFields>,
) {
  if (!target.variantOf && source.variantOf) {
    target.variantOf = source.variantOf;
  }
  if (!target.variantLabel && source.variantLabel) {
    target.variantLabel = source.variantLabel;
  }
  if (!target.variantColor && source.variantColor) {
    target.variantColor = source.variantColor;
  }
}

export function normalizeYapperCatalog(
  raw: unknown,
  syncedAt = new Date().toISOString(),
): CollectiblesCatalog {
  const rawCategories = asArray(raw);
  const itemMap = new Map<string, CollectibleCatalogItem>();
  const categoryMap = new Map<string, CollectibleCatalogCategory>();

  for (const rawCategory of rawCategories) {
    const category = asRecord(rawCategory);
    const categoryId =
      asString(category.sku_id) ??
      asString(category.store_listing_id) ??
      asString(category.name) ??
      "uncategorized";
    const categoryName = asString(category.name) ?? "Uncategorized";
    const assets = asRecord(category.assets);
    const assetUrls = asRecord(assets.url);
    const heroConfig = asRecord(
      asRecord(assets.json).hero_banner_display_config,
    );
    const textConfig = asRecord(category.text_config);
    const itemIds = new Set<string>();

    const addItems = (
      product: Record<string, any>,
      rawItems: unknown,
      variant?: VariantMeta,
    ) => {
      for (const rawItem of asArray(rawItems)) {
        const item = normalizeYapperProduct(
          category,
          product,
          asRecord(rawItem),
          variant,
        );
        if (!item) continue;
        const existing = itemMap.get(item.id);
        if (existing) {
          if (!existing.productIds) {
            existing.productIds = existing.productId
              ? [existing.productId]
              : [];
          }
          if (item.productId && !existing.productIds.includes(item.productId)) {
            existing.productIds.push(item.productId);
          }
          if (shouldReplaceExisting(existing, item)) {
            const nextProductIds = existing.productIds;
            const previousVariant = pickVariantFields(existing);
            Object.assign(existing, item);
            existing.productIds = nextProductIds;
            mergeVariantFields(existing, previousVariant);
          } else {
            mergeVariantFields(existing, pickVariantFields(item));
          }
        } else {
          item.productIds = item.productId ? [item.productId] : [];
          itemMap.set(item.id, item);
        }
        itemIds.add(item.id);
      }
    };

    for (const rawProduct of asArray(category.products)) {
      const product = asRecord(rawProduct);
      const baseVariant = variantMetaFrom(
        asRecord(asRecord(product.variant_config).variant),
      );
      addItems(product, product.items, baseVariant);

      // Colour variants (e.g. "Jack Skellington (Bones)") only exist here;
      // each one carries its own SKU, name, prices and items.
      for (const rawVariant of asArray(product.variants)) {
        const variant = asRecord(rawVariant);
        addItems(
          {
            ...variant,
            product_id: variant.product_id ?? product.product_id,
            preview_assets: variant.preview_assets ?? product.preview_assets,
            updated_at: variant.updated_at ?? product.updated_at,
          },
          variant.items,
          variantMetaFrom(variant),
        );
      }
    }

    categoryMap.set(categoryId, {
      id: categoryId,
      name: categoryName,
      summary: asString(category.summary)?.trim() ?? "",
      bannerUrl:
        asString(assetUrls.catalog_banner) ?? asString(assetUrls.hero_banner),
      logoUrl: asString(assetUrls.logo) ?? asString(assetUrls.hero_logo),
      heroBannerUrl: asString(assetUrls.hero_banner),
      heroLogoUrl: asString(assetUrls.hero_logo),
      mobileBannerUrl:
        asString(assetUrls.mobile_banner) ?? asString(assetUrls.mobile_hero),
      featuredBlockUrl: asString(assetUrls.featured_block),
      background: asCssBackground(heroConfig.background_style),
      unpublishedAt: asString(category.unpublished_at),
      marketingTitle: asString(textConfig.marketing_coachtip_title),
      marketingBody: asString(textConfig.marketing_coachtip_body),
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
    // Map insertion order = upstream order (the source shop, newest first).
    categories: [...categoryMap.values()].filter((category) =>
      category.itemIds.some((id) => itemMap.has(id)),
    ),
    items,
    counts,
    normalizerVersion: CATALOG_NORMALIZER_VERSION,
  };
}

/** Throws CatalogValidationError when `raw` is not a usable upstream list. */
export function assertUpstreamShape(raw: unknown): asserts raw is unknown[] {
  if (!Array.isArray(raw)) {
    throw new CatalogValidationError(
      "Upstream catalog is not a list of categories",
    );
  }
  if (raw.length === 0) {
    throw new CatalogValidationError("Upstream catalog is empty");
  }
}

/**
 * Rejects a normalised catalog that looks broken (schema drift, partial or
 * error payloads) so the last good catalog stays in place.
 */
export function validateNormalizedCatalog(
  next: CollectiblesCatalog,
  previous: CollectiblesCatalog | null,
  options: CatalogValidationOptions = {},
) {
  const rules = { ...DEFAULT_CATALOG_VALIDATION, ...options };
  if (next.items.length < rules.minItems) {
    throw new CatalogValidationError(
      `Upstream catalog has ${next.items.length} items (minimum ${rules.minItems})`,
    );
  }
  if (next.categories.length < rules.minCategories) {
    throw new CatalogValidationError(
      `Upstream catalog has ${next.categories.length} collections (minimum ${rules.minCategories})`,
    );
  }
  if (!previous) return;

  for (const kind of Object.keys(next.counts) as CollectibleKind[]) {
    const before = previous.counts?.[kind] ?? 0;
    if (before > rules.kindCollapseThreshold && next.counts[kind] === 0) {
      throw new CatalogValidationError(
        `Upstream catalog lost every ${kind} (had ${before})`,
      );
    }
  }

  const previousTotal = previous.items.length;
  if (
    previousTotal > 0 &&
    next.items.length < previousTotal * (1 - rules.maxShrinkRatio)
  ) {
    throw new CatalogValidationError(
      `Upstream catalog shrank from ${previousTotal} to ${next.items.length} items`,
    );
  }
}

// ── Payload encoding ────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** gzip + base64 with a version prefix; several times smaller than JSON. */
export async function encodeCatalogPayload(catalog: CollectiblesCatalog) {
  const stream = new Blob([JSON.stringify(catalog)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return `${GZIP_PREFIX}${bytesToBase64(bytes)}`;
}

/** Reads both the gzip format and legacy plain-JSON rows. */
export async function decodeCatalogPayload(payload: string): Promise<unknown> {
  if (!payload.startsWith(GZIP_PREFIX)) return JSON.parse(payload);
  const stream = new Blob([base64ToBytes(payload.slice(GZIP_PREFIX.length))])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

// ── D1 storage ──────────────────────────────────────────────────────────────

function ensureCatalogTables(db: D1Database): Promise<void> {
  const existing = readyTables.get(db);
  if (existing) return existing;
  const ready = (async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS collectible_catalog_cache (
      source TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      etag TEXT,
      category_count INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL
    )`,
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS collectible_catalog_sync_status (
      source TEXT PRIMARY KEY,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      last_error TEXT,
      last_outcome TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      category_count INTEGER NOT NULL DEFAULT 0,
      counts_json TEXT,
      last_trigger TEXT,
      last_duration_ms INTEGER
    )`,
      )
      .run();
  })();
  readyTables.set(db, ready);
  ready.catch(() => {
    if (readyTables.get(db) === ready) readyTables.delete(db);
  });
  return ready;
}

async function readCatalogCache(
  db: D1Database,
): Promise<CatalogCacheRow | null> {
  return db
    .prepare(
      `SELECT source, payload, etag, category_count, item_count, synced_at
     FROM collectible_catalog_cache
     WHERE source = ?`,
    )
    .bind(CACHE_SOURCE)
    .first<CatalogCacheRow>();
}

async function writeCatalogCache(
  db: D1Database,
  catalog: CollectiblesCatalog,
  etag?: string | null,
) {
  const { sync: _sync, ...storable } = catalog;
  const payload = await encodeCatalogPayload({ ...storable, stale: false });
  if (payload.length > MAX_ENCODED_PAYLOAD_BYTES) {
    throw new CatalogStorageError(
      `Encoded catalog is ${payload.length} bytes, over the ${MAX_ENCODED_PAYLOAD_BYTES}-byte D1 safety cap`,
    );
  }
  await db
    .prepare(
      `INSERT INTO collectible_catalog_cache (source, payload, etag, category_count, item_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       payload = excluded.payload,
       etag = excluded.etag,
       category_count = excluded.category_count,
       item_count = excluded.item_count,
       synced_at = excluded.synced_at`,
    )
    .bind(
      CACHE_SOURCE,
      payload,
      etag ?? null,
      catalog.categories.length,
      catalog.items.length,
      catalog.syncedAt,
    )
    .run();
}

async function touchCatalogCache(
  db: D1Database,
  etag: string | null,
  syncedAt: string,
) {
  await db
    .prepare(
      `UPDATE collectible_catalog_cache
     SET etag = COALESCE(?, etag),
         synced_at = ?
     WHERE source = ?`,
    )
    .bind(etag, syncedAt, CACHE_SOURCE)
    .run();
}

async function parseCachedCatalog(
  row: CatalogCacheRow,
): Promise<CollectiblesCatalog | null> {
  try {
    const parsed = (await decodeCatalogPayload(
      row.payload,
    )) as CollectiblesCatalog;
    if (parsed?.version !== 1 || parsed.source !== "yapper") return null;
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.categories)) {
      return null;
    }
    return { ...parsed, syncedAt: row.synced_at };
  } catch {
    return null;
  }
}

function isCatalogStale(
  catalog: CollectiblesCatalog,
  syncedAt: string,
  now = Date.now(),
) {
  const syncedAtMs = Date.parse(syncedAt);
  return (
    catalog.normalizerVersion !== CATALOG_NORMALIZER_VERSION ||
    Number.isNaN(syncedAtMs) ||
    now - syncedAtMs > CATALOG_STALE_AFTER_MS
  );
}

async function readSyncStatusRow(db: D1Database, source = CACHE_SOURCE) {
  return db
    .prepare(
      `SELECT source, last_attempt_at, last_success_at, last_failure_at, last_error,
       last_outcome, consecutive_failures, item_count, category_count, counts_json,
       last_trigger, last_duration_ms
     FROM collectible_catalog_sync_status
     WHERE source = ?`,
    )
    .bind(source)
    .first<SyncStatusRow>();
}

function rowToSyncStatus(
  row: SyncStatusRow | null | undefined,
): CollectiblesSyncStatus {
  if (!row) return defaultSyncStatus();
  const outcome = row.last_outcome;
  return {
    lastAttemptAt: row.last_attempt_at ?? undefined,
    lastSuccessAt: row.last_success_at ?? undefined,
    lastFailureAt: row.last_failure_at ?? undefined,
    lastError: row.last_error ?? undefined,
    lastOutcome:
      outcome === "updated" ||
      outcome === "not_modified" ||
      outcome === "rejected" ||
      outcome === "failed"
        ? outcome
        : undefined,
    consecutiveFailures: row.consecutive_failures ?? 0,
  };
}

async function recordSyncAttempt(
  db: D1Database,
  previous: SyncStatusRow | null,
  attempt: {
    trigger: CollectiblesSyncTrigger;
    outcome: CollectiblesSyncOutcome;
    startedAtMs: number;
    error?: unknown;
    catalog?: CollectiblesCatalog;
  },
): Promise<CollectiblesSyncStatus> {
  const finishedAt = new Date().toISOString();
  const succeeded =
    attempt.outcome === "updated" || attempt.outcome === "not_modified";
  const row: SyncStatusRow = {
    source: CACHE_SOURCE,
    last_attempt_at: finishedAt,
    last_success_at: succeeded
      ? finishedAt
      : (previous?.last_success_at ?? null),
    last_failure_at: succeeded
      ? (previous?.last_failure_at ?? null)
      : finishedAt,
    last_error: succeeded
      ? null
      : describeError(attempt.error ?? "Unknown sync failure"),
    last_outcome: attempt.outcome,
    consecutive_failures: succeeded
      ? 0
      : (previous?.consecutive_failures ?? 0) + 1,
    item_count: attempt.catalog?.items.length ?? previous?.item_count ?? 0,
    category_count:
      attempt.catalog?.categories.length ?? previous?.category_count ?? 0,
    counts_json: attempt.catalog
      ? JSON.stringify(attempt.catalog.counts)
      : (previous?.counts_json ?? null),
    last_trigger: attempt.trigger,
    last_duration_ms: Date.now() - attempt.startedAtMs,
  };

  await writeSyncStatusRow(db, row);
  const status = rowToSyncStatus(row);
  memorySyncStatus = status;
  return status;
}

async function writeSyncStatusRow(db: D1Database, row: SyncStatusRow) {
  try {
    await db
      .prepare(
        `INSERT INTO collectible_catalog_sync_status (source, last_attempt_at, last_success_at,
         last_failure_at, last_error, last_outcome, consecutive_failures, item_count,
         category_count, counts_json, last_trigger, last_duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         last_failure_at = excluded.last_failure_at,
         last_error = excluded.last_error,
         last_outcome = excluded.last_outcome,
         consecutive_failures = excluded.consecutive_failures,
         item_count = excluded.item_count,
         category_count = excluded.category_count,
         counts_json = excluded.counts_json,
         last_trigger = excluded.last_trigger,
         last_duration_ms = excluded.last_duration_ms`,
      )
      .bind(
        row.source,
        row.last_attempt_at,
        row.last_success_at,
        row.last_failure_at,
        row.last_error,
        row.last_outcome,
        row.consecutive_failures,
        row.item_count,
        row.category_count,
        row.counts_json,
        row.last_trigger,
        row.last_duration_ms,
      )
      .run();
  } catch (error) {
    // Status is telemetry; never let it mask the sync result.
    console.error(
      "Collectibles sync status write failed:",
      describeError(error),
    );
  }
}

// ── Memory cache ────────────────────────────────────────────────────────────

function primeMemoryCatalog(
  catalog: CollectiblesCatalog,
  etag: string | null,
  syncedAt = catalog.syncedAt,
) {
  memoryCatalogEntry = {
    catalog: { ...catalog, syncedAt, stale: false, sync: undefined },
    etag,
    loadedAtMs: Date.now(),
  };
  return memoryCatalogEntry;
}

function withFreshness(
  catalog: CollectiblesCatalog,
  syncedAt: string,
  now = Date.now(),
): CollectiblesCatalog {
  return {
    ...catalog,
    syncedAt,
    stale: isCatalogStale(catalog, syncedAt, now),
    sync: memorySyncStatus ?? defaultSyncStatus(),
  };
}

// ── Upstream ────────────────────────────────────────────────────────────────

type UpstreamResult =
  | { notModified: true; etag: string | null }
  | { notModified: false; etag: string | null; raw: unknown[] };

type UpstreamSource = (knownEtag: string | null) => Promise<UpstreamResult>;

async function fetchYapperCatalog(
  cachedEtag: string | null,
): Promise<UpstreamResult> {
  const response = await fetch(YAPPER_CATALOG_URL, {
    headers: {
      ...YAPPER_HEADERS,
      ...(cachedEtag ? { "If-None-Match": cachedEtag } : {}),
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (response.status === 304) {
    return {
      notModified: true,
      etag: cachedEtag ?? response.headers.get("etag"),
    };
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
    } catch {
      // body unreadable; the status is enough
    }
    throw new Error(
      `Yapper catalog fetch failed with ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new CatalogValidationError("Upstream catalog is not valid JSON");
  }
  assertUpstreamShape(raw);
  return { notModified: false, etag: response.headers.get("etag"), raw };
}

async function syncCollectiblesCatalogOnce(
  db: D1Database,
  options: SyncCollectiblesOptions,
  upstream: UpstreamSource = fetchYapperCatalog,
): Promise<CollectiblesCatalog> {
  const trigger = options.trigger ?? "manual";
  const startedAtMs = Date.now();
  await ensureCatalogTables(db);
  const [row, statusRow] = await Promise.all([
    readCatalogCache(db),
    readSyncStatusRow(db),
  ]);
  const cached = row ? await parseCachedCatalog(row) : null;
  const known = cached ?? memoryCatalogEntry?.catalog ?? null;
  const knownIsCurrent =
    known?.normalizerVersion === CATALOG_NORMALIZER_VERSION;
  const knownEtag = knownIsCurrent
    ? (row?.etag ?? memoryCatalogEntry?.etag ?? null)
    : null;

  try {
    const result = await upstream(knownEtag);
    let catalog: CollectiblesCatalog;
    let outcome: CollectiblesSyncOutcome;
    let etag = result.etag;

    if (result.notModified) {
      if (!known || !knownIsCurrent) {
        throw new Error(
          "Upstream returned 304 but no current catalog is cached",
        );
      }
      const syncedAt = new Date().toISOString();
      catalog = { ...known, syncedAt, stale: false };
      etag = etag ?? knownEtag;
      if (row) {
        await touchCatalogCache(db, etag, syncedAt);
      } else {
        await writeCatalogCache(db, catalog, etag);
      }
      outcome = "not_modified";
    } else {
      catalog = normalizeYapperCatalog(result.raw);
      validateNormalizedCatalog(catalog, known, options.validation);
      await writeCatalogCache(db, catalog, etag);
      outcome = "updated";
    }

    const status = await recordSyncAttempt(db, statusRow, {
      trigger,
      outcome,
      startedAtMs,
      catalog,
    });
    const entry = primeMemoryCatalog(catalog, etag, catalog.syncedAt);
    return { ...entry.catalog, stale: false, sync: status };
  } catch (error) {
    await deferIfCoveredByIngest(db, trigger, startedAtMs, error);
    await recordSyncAttempt(db, statusRow, {
      trigger,
      outcome: error instanceof CatalogValidationError ? "rejected" : "failed",
      startedAtMs,
      error,
    });
    throw error;
  }
}

/**
 * Throws CatalogFetchDeferredError (after a warning) when a cron/request
 * fetch failed but an ingest succeeded within INGEST_FALLBACK_WINDOW_MS, so
 * a blocked upstream does not pile up failures while ingest keeps up.
 */
async function deferIfCoveredByIngest(
  db: D1Database,
  trigger: CollectiblesSyncTrigger,
  startedAtMs: number,
  error: unknown,
) {
  if (trigger !== "cron" && trigger !== "request") return;
  if (
    error instanceof CatalogValidationError ||
    error instanceof CatalogStorageError
  ) {
    return;
  }
  const ingest = await readSyncStatusRow(db, INGEST_STATUS_SOURCE).catch(
    () => null,
  );
  const lastIngestMs = Date.parse(ingest?.last_success_at ?? "");
  if (
    Number.isNaN(lastIngestMs) ||
    startedAtMs - lastIngestMs > INGEST_FALLBACK_WINDOW_MS
  ) {
    return;
  }
  const message = describeError(error);
  console.warn(
    `Collectibles ${trigger} sync failed; ingest at ${ingest?.last_success_at} keeps the catalog current: ${message}`,
  );
  throw new CatalogFetchDeferredError(message);
}

/**
 * Fetches the upstream catalog (conditional on the cached ETag), validates it
 * and replaces the cache. On any failure the last good catalog stays and the
 * attempt is recorded in collectible_catalog_sync_status. Concurrent calls in
 * one isolate share a single upstream request.
 */
export async function syncCollectiblesCatalog(
  db: D1Database,
  options: SyncCollectiblesOptions = {},
): Promise<CollectiblesCatalog> {
  if (inFlightCatalogSync) return inFlightCatalogSync;

  const trackedSync = syncCollectiblesCatalogOnce(db, options).finally(() => {
    if (inFlightCatalogSync === trackedSync) inFlightCatalogSync = null;
  });
  inFlightCatalogSync = trackedSync;
  return trackedSync;
}

function scheduleBackgroundRefresh(
  db: D1Database,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  now: number,
) {
  if (!waitUntil || inFlightCatalogSync) return;
  const lastAttemptMs = Date.parse(memorySyncStatus?.lastAttemptAt ?? "");
  const lastMs = Math.max(
    lastRequestRefreshAtMs,
    Number.isNaN(lastAttemptMs) ? 0 : lastAttemptMs,
  );
  if (now - lastMs < REQUEST_REFRESH_COOLDOWN_MS) return;
  lastRequestRefreshAtMs = now;
  waitUntil(
    syncCollectiblesCatalog(db, { trigger: "request" }).catch((error) => {
      if (error instanceof CatalogFetchDeferredError) return;
      console.error(
        "Collectibles background refresh failed:",
        describeError(error),
      );
    }),
  );
}

/**
 * Serves the cached catalog without waiting on upstream whenever one exists.
 * A stale cache is returned as-is (stale: true) and refreshed in the
 * background through `waitUntil`, throttled. Only an empty cache blocks on
 * upstream. `forceRefresh` is for admins and is never exposed to everyone.
 */
export async function getCollectiblesCatalog(
  db: D1Database,
  options: {
    forceRefresh?: boolean;
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {},
): Promise<CollectiblesCatalog> {
  const now = Date.now();
  if (
    !options.forceRefresh &&
    memoryCatalogEntry &&
    memorySyncStatus &&
    now - memoryCatalogEntry.loadedAtMs < MEMORY_RECHECK_MS
  ) {
    const served = withFreshness(
      memoryCatalogEntry.catalog,
      memoryCatalogEntry.catalog.syncedAt,
      now,
    );
    if (served.stale) scheduleBackgroundRefresh(db, options.waitUntil, now);
    return served;
  }

  await ensureCatalogTables(db);
  const [row, statusRow] = await Promise.all([
    readCatalogCache(db),
    readSyncStatusRow(db),
  ]);
  memorySyncStatus = rowToSyncStatus(statusRow);
  const cached = row ? await parseCachedCatalog(row) : null;

  if (cached && row) {
    primeMemoryCatalog(cached, row.etag, row.synced_at);
    const served = withFreshness(cached, row.synced_at, now);
    if (options.forceRefresh) {
      try {
        return await syncCollectiblesCatalog(db, { trigger: "manual" });
      } catch {
        return withFreshness(cached, row.synced_at, now);
      }
    }
    if (served.stale) scheduleBackgroundRefresh(db, options.waitUntil, now);
    return served;
  }

  try {
    return await syncCollectiblesCatalog(db, {
      trigger: options.forceRefresh ? "manual" : "request",
    });
  } catch (error) {
    console.error("Collectibles catalog unavailable:", describeError(error));
    throw new Error("Unable to load collectibles catalog");
  }
}

export async function getCollectiblesSyncStatus(
  db: D1Database,
): Promise<CollectiblesSyncStatus> {
  await ensureCatalogTables(db);
  const status = rowToSyncStatus(await readSyncStatusRow(db));
  memorySyncStatus = status;
  return status;
}

/** Milliseconds until a manual sync is allowed again (0 = allowed now). */
export function manualSyncRetryAfterMs(
  status: CollectiblesSyncStatus,
  now = Date.now(),
) {
  const lastAttemptMs = Date.parse(status.lastAttemptAt ?? "");
  if (Number.isNaN(lastAttemptMs)) return 0;
  return Math.max(0, lastAttemptMs + MANUAL_SYNC_COOLDOWN_MS - now);
}

// ── Ingest (upstream fetched off Cloudflare and pushed here) ────────────────

export type CollectiblesIngestInput =
  /** The raw upstream body as fetched, plus its ETag. */
  | { notModified?: false; body: string; etag: string | null }
  /** Upstream answered 304 to `etag`; only refreshes syncedAt. */
  | { notModified: true; etag: string };

export type CollectiblesIngestState = {
  /** ETag of the stored catalog; null when absent or from another normaliser. */
  etag: string | null;
  syncedAt: string | null;
  formatVersion: number;
  /** Last upload attempt, for the ingest rate limit. */
  lastUploadAt: string | null;
};

export async function getCollectiblesIngestState(
  db: D1Database,
): Promise<CollectiblesIngestState> {
  await ensureCatalogTables(db);
  const [row, ingest] = await Promise.all([
    readCatalogCache(db),
    readSyncStatusRow(db, INGEST_STATUS_SOURCE),
  ]);
  const cached = row ? await parseCachedCatalog(row) : null;
  const current = cached?.normalizerVersion === CATALOG_NORMALIZER_VERSION;
  return {
    etag: current ? (row?.etag ?? null) : null,
    syncedAt: row?.synced_at ?? null,
    formatVersion: CATALOG_NORMALIZER_VERSION,
    lastUploadAt: ingest?.last_attempt_at ?? null,
  };
}

/** Milliseconds until another ingest upload is accepted (0 = now). */
export function ingestRetryAfterMs(
  state: Pick<CollectiblesIngestState, "lastUploadAt">,
  now = Date.now(),
) {
  const lastMs = Date.parse(state.lastUploadAt ?? "");
  if (Number.isNaN(lastMs)) return 0;
  return Math.max(0, lastMs + INGEST_COOLDOWN_MS - now);
}

function ingestUpstream(input: CollectiblesIngestInput): UpstreamSource {
  return async (knownEtag) => {
    if (input.notModified) {
      if (!knownEtag || input.etag !== knownEtag) {
        throw new CatalogIngestConflictError(
          "Not-modified ingest does not match the stored ETag; upload the body",
        );
      }
      return { notModified: true, etag: knownEtag };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(input.body);
    } catch {
      throw new CatalogValidationError("Upstream catalog is not valid JSON");
    }
    assertUpstreamShape(raw);
    return { notModified: false, etag: input.etag, raw };
  };
}

async function recordIngestAttempt(
  db: D1Database,
  previous: SyncStatusRow | null,
  attempt: {
    uploaded: boolean;
    startedAtMs: number;
    outcome: CollectiblesSyncOutcome;
    error?: unknown;
  },
) {
  const now = new Date().toISOString();
  const succeeded =
    attempt.outcome === "updated" || attempt.outcome === "not_modified";
  await writeSyncStatusRow(db, {
    source: INGEST_STATUS_SOURCE,
    last_attempt_at: attempt.uploaded
      ? now
      : (previous?.last_attempt_at ?? null),
    last_success_at: succeeded ? now : (previous?.last_success_at ?? null),
    last_failure_at: succeeded ? (previous?.last_failure_at ?? null) : now,
    last_error: succeeded
      ? null
      : describeError(attempt.error ?? "Unknown ingest failure"),
    last_outcome: attempt.outcome,
    consecutive_failures: succeeded
      ? 0
      : (previous?.consecutive_failures ?? 0) + 1,
    item_count: 0,
    category_count: 0,
    counts_json: null,
    last_trigger: "ingest",
    last_duration_ms: Date.now() - attempt.startedAtMs,
  });
}

/**
 * Stores an upstream catalog fetched outside Cloudflare (upstream blocks
 * Workers egress). Same normalise → validate → store path and status row as
 * the cron, recorded with trigger "ingest". Waits for an in-flight sync
 * instead of joining it, so the pushed payload is never dropped.
 */
export async function ingestCollectiblesCatalog(
  db: D1Database,
  input: CollectiblesIngestInput,
  options: Pick<SyncCollectiblesOptions, "validation"> = {},
): Promise<CollectiblesCatalog> {
  const startedAtMs = Date.now();
  const uploaded = !input.notModified;
  await ensureCatalogTables(db);
  const previous = await readSyncStatusRow(db, INGEST_STATUS_SOURCE);

  if (inFlightCatalogSync) await inFlightCatalogSync.catch(() => undefined);
  const tracked = syncCollectiblesCatalogOnce(
    db,
    { ...options, trigger: "ingest" },
    ingestUpstream(input),
  ).finally(() => {
    if (inFlightCatalogSync === tracked) inFlightCatalogSync = null;
  });
  inFlightCatalogSync = tracked;

  try {
    const catalog = await tracked;
    await recordIngestAttempt(db, previous, {
      uploaded,
      startedAtMs,
      outcome: catalog.sync?.lastOutcome ?? "updated",
    });
    return catalog;
  } catch (error) {
    await recordIngestAttempt(db, previous, {
      uploaded,
      startedAtMs,
      outcome: error instanceof CatalogValidationError ? "rejected" : "failed",
      error,
    });
    throw error;
  }
}

/** Parses COLLECTIBLES_ADMIN_USER_IDS ("id1, id2"); unset means nobody. */
export function parseCollectiblesAdminIds(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function findCollectibleItem(
  catalog: CollectiblesCatalog,
  skuIdOrId: string,
) {
  return (
    catalog.items.find(
      (item) => item.id === skuIdOrId || item.skuId === skuIdOrId,
    ) ?? null
  );
}
