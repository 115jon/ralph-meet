/**
 * Pure view helpers for the shop and the per-type collectible pickers:
 * collection sections in source order, search, variant families, collection
 * status ("Leaves in 3 days") and price labels. No React, so it is unit-tested.
 */

import type {
  CollectibleCatalogCategory,
  CollectibleCatalogItem,
  CollectibleKind,
  CollectiblesCatalog,
} from "@/lib/collectibles-catalog";

export const COLLECTIBLE_KINDS: CollectibleKind[] = [
  "avatar_decoration",
  "profile_effect",
  "nameplate",
  "profile_frame",
];

export const KIND_COPY: Record<
  CollectibleKind,
  { one: string; many: string; pickerTitle: string; noneLabel: string }
> = {
  avatar_decoration: {
    one: "Avatar decoration",
    many: "Decorations",
    pickerTitle: "Avatar decoration",
    noneLabel: "No decoration",
  },
  profile_effect: {
    one: "Profile effect",
    many: "Effects",
    pickerTitle: "Profile effect",
    noneLabel: "No effect",
  },
  nameplate: {
    one: "Nameplate",
    many: "Nameplates",
    pickerTitle: "Nameplate",
    noneLabel: "No nameplate",
  },
  profile_frame: {
    one: "Profile frame",
    many: "Frames",
    pickerTitle: "Profile frame",
    noneLabel: "No frame",
  },
};

export type CollectionSection = {
  category: CollectibleCatalogCategory;
  items: CollectibleCatalogItem[];
};

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function itemMatchesQuery(
  item: CollectibleCatalogItem,
  normalizedQuery: string,
) {
  if (!normalizedQuery) return true;
  return [
    item.name,
    item.categoryName,
    item.label ?? "",
    item.variantLabel ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

/**
 * Items of the given kinds grouped by collection, in the source shop's order
 * (newest collection first). An item listed in several collections appears in
 * its first one only, so a grid never shows duplicates.
 */
export function buildCollectionSections(
  catalog: CollectiblesCatalog | null | undefined,
  options: { kinds?: CollectibleKind[]; query?: string } = {},
): CollectionSection[] {
  if (!catalog) return [];
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const normalizedQuery = normalizeQuery(options.query ?? "");
  const byId = new Map(catalog.items.map((item) => [item.id, item] as const));
  const seen = new Set<string>();
  const sections: CollectionSection[] = [];

  for (const category of catalog.categories) {
    const items: CollectibleCatalogItem[] = [];
    for (const id of category.itemIds) {
      if (seen.has(id)) continue;
      const item = byId.get(id);
      if (!item) continue;
      if (kinds && !kinds.has(item.kind)) continue;
      seen.add(id);
      if (!itemMatchesQuery(item, normalizedQuery)) continue;
      items.push(item);
    }
    if (items.length) sections.push({ category, items });
  }

  // Items no collection lists (shouldn't happen, but never hide them).
  const orphans = catalog.items.filter(
    (item) =>
      !seen.has(item.id) &&
      (!kinds || kinds.has(item.kind)) &&
      itemMatchesQuery(item, normalizedQuery),
  );
  if (orphans.length) {
    sections.push({
      category: {
        id: "__more",
        name: "More",
        summary: "",
        itemIds: orphans.map((item) => item.id),
      },
      items: orphans,
    });
  }

  return sections;
}

export function countSectionItems(sections: CollectionSection[]) {
  return sections.reduce((total, section) => total + section.items.length, 0);
}

export function findItemBySku(
  catalog: CollectiblesCatalog | null | undefined,
  kind: CollectibleKind,
  skuId: string | null | undefined,
) {
  if (!catalog || !skuId) return null;
  return (
    catalog.items.find((item) => item.kind === kind && item.skuId === skuId) ??
    null
  );
}

export type CollectionStatus =
  | { tone: "leaving"; label: string; daysLeft: number }
  | { tone: "retired"; label: string }
  | null;

const DAY_MS = 86_400_000;

/**
 * "Leaves in N days" for collections the source shop is about to pull (within
 * two weeks), "Retired" once they're gone. The source still serves retired
 * art, so they stay usable here.
 */
export function collectionStatus(
  category: Pick<CollectibleCatalogCategory, "unpublishedAt">,
  now = Date.now(),
): CollectionStatus {
  if (!category.unpublishedAt) return null;
  const at = Date.parse(category.unpublishedAt);
  if (Number.isNaN(at)) return null;
  if (at <= now) return { tone: "retired", label: "Retired" };
  const daysLeft = Math.ceil((at - now) / DAY_MS);
  if (daysLeft > 14) return null;
  return {
    tone: "leaving",
    daysLeft,
    label: daysLeft <= 1 ? "Leaves today" : `Leaves in ${daysLeft} days`,
  };
}

/** The source shop's price, for showing what Ralph Meet gives away free. */
export function formatSourcePrice(item: CollectibleCatalogItem) {
  const price = item.price ?? item.nitroPrice;
  if (!price) return null;
  if (price.currency === "discord_orb") {
    return `${new Intl.NumberFormat("en-US").format(price.amount)} Orbs`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(price.amount / 10 ** price.exponent);
  } catch {
    return null;
  }
}

/** Display name without a trailing "(Variant)" suffix. */
export function baseItemName(item: Pick<CollectibleCatalogItem, "name">) {
  return item.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || item.name;
}

export function variantName(item: CollectibleCatalogItem) {
  if (item.variantLabel) return item.variantLabel;
  const match = item.name.match(/\(([^)]+)\)\s*$/);
  return match?.[1] ?? null;
}

/** Key shared by all colour variants of one design. */
function variantFamilyKey(item: CollectibleCatalogItem) {
  return `${item.kind}:${item.variantOf ?? item.skuId}`;
}

/**
 * Collapse colour variants into families for the shop grid. The family's
 * representative is the base variant when present, else the first seen.
 */
export function groupVariantFamilies(items: CollectibleCatalogItem[]) {
  const families = new Map<string, CollectibleCatalogItem[]>();
  for (const item of items) {
    const key = variantFamilyKey(item);
    const family = families.get(key);
    if (family) family.push(item);
    else families.set(key, [item]);
  }
  return [...families.entries()].map(([key, members]) => {
    const base =
      members.find((member) => member.skuId === member.variantOf) ??
      members[0]!;
    return {
      key,
      base,
      variants: [base, ...members.filter((member) => member !== base)],
    };
  });
}

export type VariantFamily = ReturnType<typeof groupVariantFamilies>[number];
