import { describe, expect, it } from "vitest";

import sample from "@/lib/__fixtures__/yapper-catalog.sample.json";
import {
  decorationMotionUrl,
  decorationStillUrl,
  effectStillUrl,
  collectionHeroArt,
  collectionStripArt,
  resizedShopImageUrl,
} from "@/lib/collectible-assets";
import {
  baseItemName,
  buildCollectionSections,
  collectionStatus,
  countSectionItems,
  findItemBySku,
  formatSourcePrice,
  groupVariantFamilies,
  variantName,
} from "@/lib/collectible-catalog-view";
import {
  displayWithCollectible,
  selectedSkuForKind,
} from "@/lib/collectible-selection";
import {
  normalizeYapperCatalog,
  type CollectibleCatalogItem,
} from "@/lib/collectibles-catalog";

const catalog = normalizeYapperCatalog(sample, "2026-10-23T12:00:00.000Z");

describe("buildCollectionSections", () => {
  it("keeps the source shop's collection order and filters by kind", () => {
    const sections = buildCollectionSections(catalog, {
      kinds: ["avatar_decoration"],
    });
    expect(sections[0]?.category.name).toBe("The Nightmare Before Christmas");
    expect(
      sections.every((section) =>
        section.items.every((item) => item.kind === "avatar_decoration"),
      ),
    ).toBe(true);
    expect(countSectionItems(sections)).toBe(catalog.counts.avatar_decoration);
  });

  it("never lists an item twice across collections", () => {
    const ids = buildCollectionSections(catalog).flatMap((section) =>
      section.items.map((item) => item.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(catalog.items.length);
  });

  it("searches names, collections and variant labels", () => {
    const byName = buildCollectionSections(catalog, { query: "jack" });
    expect(countSectionItems(byName)).toBeGreaterThan(0);
    expect(
      byName
        .flatMap((section) => section.items)
        .every((item) =>
          `${item.name} ${item.categoryName} ${item.label ?? ""} ${item.variantLabel ?? ""}`
            .toLowerCase()
            .includes("jack"),
        ),
    ).toBe(true);
    expect(
      buildCollectionSections(catalog, { query: "zzzz-no-such-thing" }),
    ).toEqual([]);
  });

  it("returns nothing without a catalog", () => {
    expect(buildCollectionSections(null)).toEqual([]);
  });
});

describe("variant families", () => {
  it("groups colour variants under their base design", () => {
    const decorations = catalog.items.filter(
      (item) => item.kind === "avatar_decoration",
    );
    const families = groupVariantFamilies(decorations);
    const jack = families.find((family) =>
      family.variants.some((item) => item.name === "Jack Skellington (Bones)"),
    );
    expect(jack).toBeDefined();
    expect(jack!.base.name).toBe("Jack Skellington");
    expect(jack!.variants.map((item) => variantName(item))).toEqual([
      "Base",
      "Bones",
    ]);
    expect(families.length).toBeLessThan(decorations.length);
  });

  it("strips the variant suffix for display", () => {
    expect(baseItemName({ name: "Ooogie Boogie (Bats)" })).toBe(
      "Ooogie Boogie",
    );
    expect(baseItemName({ name: "Zero" })).toBe("Zero");
  });
});

describe("collectionStatus", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  it("flags collections leaving within two weeks", () => {
    expect(
      collectionStatus({ unpublishedAt: "2026-11-03T07:59:59+00:00" }, now),
    ).toEqual({ tone: "leaving", daysLeft: 11, label: "Leaves in 11 days" });
  });
  it("ignores far-off dates and marks past ones retired", () => {
    expect(
      collectionStatus({ unpublishedAt: "2027-06-18T06:59:59+00:00" }, now),
    ).toBeNull();
    expect(
      collectionStatus({ unpublishedAt: "2025-12-11T17:00:00+00:00" }, now),
    ).toEqual({ tone: "retired", label: "Retired" });
    expect(collectionStatus({}, now)).toBeNull();
  });
});

describe("formatSourcePrice", () => {
  it("formats currency and orbs", () => {
    const base = catalog.items[0]!;
    expect(
      formatSourcePrice({
        ...base,
        price: { amount: 899, currency: "usd", exponent: 2 },
      }),
    ).toBe("$8.99");
    expect(
      formatSourcePrice({
        ...base,
        price: { amount: 1400, currency: "discord_orb", exponent: 0 },
      }),
    ).toBe("1,400 Orbs");
    expect(
      formatSourcePrice({ ...base, price: undefined, nitroPrice: undefined }),
    ).toBeNull();
  });
});

describe("collectible asset urls", () => {
  const decoration = catalog.items.find(
    (item) => item.kind === "avatar_decoration",
  ) as CollectibleCatalogItem;
  const effect = catalog.items.find(
    (item) => item.kind === "profile_effect",
  ) as CollectibleCatalogItem;

  it("uses the static first frame for decoration thumbnails", () => {
    const still = decorationStillUrl(decoration, 96)!;
    expect(still).toContain("passthrough=false");
    expect(still).toContain("size=96");
    expect(decorationMotionUrl(decoration)).toContain("passthrough=true");
  });

  it("resizes effect frames through the media proxy at the profile ratio", () => {
    const url = new URL(effectStillUrl(effect, 150)!);
    expect(url.hostname).toBe("media.discordapp.net");
    expect(url.searchParams.get("width")).toBe("150");
    expect(url.searchParams.get("height")).toBe("293");
  });

  it("leaves non-shop urls alone", () => {
    expect(
      resizedShopImageUrl("https://cdn.discordapp.com/assets/x.png", 10, 10),
    ).toBe("https://cdn.discordapp.com/assets/x.png");
    expect(resizedShopImageUrl(undefined, 10, 10)).toBeUndefined();
  });

  it("picks strip or hero art with the right aspect", () => {
    const category = catalog.categories[0]!;
    const strip = collectionStripArt(category, 1060)!;
    expect(strip.aspect).toBeCloseTo(2120 / 360);
    expect(new URL(strip.src).searchParams.get("height")).toBe("180");
    const hero = collectionHeroArt(category, 1600)!;
    expect(hero.aspect).toBeCloseTo(3330 / 1050);
    expect(collectionHeroArt({}, 100)).toBeNull();
  });
});

describe("displayWithCollectible (per-type selection)", () => {
  const byKind = (kind: CollectibleCatalogItem["kind"]) =>
    catalog.items.find((item) => item.kind === kind)!;

  it("swaps one slot and keeps the others and the crop", () => {
    const decoration = byKind("avatar_decoration");
    const effect = byKind("profile_effect");
    const start = displayWithCollectible(
      { version: 1, crop: { x: 10, y: 10, width: 50, height: 50 } },
      "avatar_decoration",
      decoration,
    );
    const next = displayWithCollectible(start, "profile_effect", effect);
    expect(selectedSkuForKind(next, "avatar_decoration")).toBe(
      decoration.skuId,
    );
    expect(selectedSkuForKind(next, "profile_effect")).toBe(effect.skuId);
    expect(next?.crop).toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });

  it("clears a slot with null and ignores an item of another kind", () => {
    const nameplate = byKind("nameplate");
    const frame = byKind("profile_frame");
    const withPlate = displayWithCollectible(null, "nameplate", nameplate);
    expect(selectedSkuForKind(withPlate, "nameplate")).toBe(nameplate.skuId);
    expect(
      selectedSkuForKind(
        displayWithCollectible(withPlate, "nameplate", null),
        "nameplate",
      ),
    ).toBeUndefined();
    const mismatched = displayWithCollectible(withPlate, "nameplate", frame);
    expect(selectedSkuForKind(mismatched, "nameplate")).toBeUndefined();
    expect(selectedSkuForKind(mismatched, "profile_frame")).toBeUndefined();
  });

  it("finds the equipped item by sku within a kind", () => {
    const frame = byKind("profile_frame");
    expect(findItemBySku(catalog, "profile_frame", frame.skuId)?.id).toBe(
      frame.id,
    );
    expect(findItemBySku(catalog, "nameplate", frame.skuId)).toBeNull();
    expect(findItemBySku(catalog, "nameplate", null)).toBeNull();
  });
});
