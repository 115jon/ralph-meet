import { normalizeAvatarDisplay } from "@/lib/avatar-display";
import {
  collectibleItemToSelection,
  getBundleConstituentItems,
  isBundleFullyApplied,
} from "@/lib/collectible-selection";
import type {
  CollectibleCatalogItem,
  CollectiblesCatalog,
} from "@/lib/collectibles-catalog";
import { describe, expect, it } from "vitest";

function makeCatalogItem(
  overrides: Partial<CollectibleCatalogItem> &
    Pick<
      CollectibleCatalogItem,
      "id" | "skuId" | "name" | "kind" | "productType" | "itemType"
    >,
): CollectibleCatalogItem {
  return {
    summary: "",
    source: "yapper",
    categoryId: "toy-story",
    categoryName: "Toy Story",
    ...overrides,
  };
}

describe("collectibleItemToSelection", () => {
  it("preserves the full profile effect payload for previews and storage", () => {
    const item: CollectibleCatalogItem = {
      id: "profile_effect:123",
      skuId: "123",
      name: "D20 Roll",
      summary: "A randomized dice animation",
      kind: "profile_effect",
      source: "yapper",
      categoryId: "dnd",
      categoryName: "Dungeons & Dragons",
      productType: 0,
      itemType: 1,
      previewUrl:
        "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/preview",
      staticUrl:
        "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static",
      animatedUrl: "https://cdn.discordapp.com/assets/content/dice-roll-a",
      profileEffect: {
        animationType: 2,
        thumbnailPreviewSrc:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/thumb",
        reducedMotionSrc:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/reduced",
        staticFrameSrc:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/frame",
        effects: [
          {
            src: "https://cdn.discordapp.com/assets/content/dice-roll-a",
            loop: false,
            duration: 3250,
            start: 0,
            loopDelay: 0,
            zIndex: 100,
            width: 450,
            height: 880,
            position: {
              x: 0,
              y: 0,
            },
            randomizedSources: [
              { src: "https://cdn.discordapp.com/assets/content/dice-roll-a" },
              { src: "https://cdn.discordapp.com/assets/content/dice-roll-b" },
            ],
          },
        ],
      },
    };

    expect(collectibleItemToSelection(item)).toEqual({
      profileEffect: {
        skuId: "123",
        name: "D20 Roll",
        animationType: 2,
        previewUrl:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/preview",
        thumbnailPreviewSrc:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/thumb",
        reducedMotionSrc:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/reduced",
        staticFrameSrc:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/frame",
        staticUrl:
          "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static",
        animatedUrl: "https://cdn.discordapp.com/assets/content/dice-roll-a",
        effectUrls: ["https://cdn.discordapp.com/assets/content/dice-roll-a"],
        effects: [
          {
            src: "https://cdn.discordapp.com/assets/content/dice-roll-a",
            loop: false,
            duration: 3250,
            start: 0,
            loopDelay: 0,
            zIndex: 100,
            width: 450,
            height: 880,
            position: {
              x: 0,
              y: 0,
            },
            randomizedSources: [
              { src: "https://cdn.discordapp.com/assets/content/dice-roll-a" },
              { src: "https://cdn.discordapp.com/assets/content/dice-roll-b" },
            ],
          },
        ],
      },
    });
  });

  it("preserves nameplate palette metadata for contrast-aware UI", () => {
    const item = makeCatalogItem({
      id: "nameplate:123",
      skuId: "123",
      name: "Buzz Lightyear",
      kind: "nameplate",
      productType: 0,
      itemType: 2,
      staticUrl:
        "https://cdn.discordapp.com/assets/collectibles/buzzstatic.png",
      animatedUrl:
        "https://cdn.discordapp.com/assets/collectibles/buzzasset.webm",
      palette: "violet",
    });

    expect(collectibleItemToSelection(item)).toEqual({
      nameplate: {
        skuId: "123",
        name: "Buzz Lightyear",
        staticUrl:
          "https://cdn.discordapp.com/assets/collectibles/buzzstatic.png",
        animatedUrl:
          "https://cdn.discordapp.com/assets/collectibles/buzzasset.webm",
        palette: "violet",
      },
    });
  });
});

describe("bundle collectible helpers", () => {
  const bundleProductId = "1513675834077220925";
  const bundle = makeCatalogItem({
    id: "profile_effect:bundle",
    skuId: "1513676556483166358",
    productId: bundleProductId,
    productIds: [bundleProductId, "single-effect-product"],
    name: "Falling With Style (Base)",
    kind: "profile_effect",
    productType: 1005,
    itemType: 1,
    staticUrl:
      "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static",
    animatedUrl:
      "https://cdn.discordapp.com/assets/content/falling-with-style-a",
    profileEffect: {
      effects: [
        {
          src: "https://cdn.discordapp.com/assets/content/falling-with-style-a",
          loop: true,
          duration: 4906,
          start: 7906,
          loopDelay: 3000,
          zIndex: 100,
          width: 450,
          height: 880,
          position: { x: 0, y: 0 },
        },
      ],
    },
  });
  const decoration = makeCatalogItem({
    id: "avatar_decoration:buzz",
    skuId: "1513658048445550815",
    productId: "1513658174350299278",
    productIds: [bundleProductId],
    name: "Buzz Lightyear",
    kind: "avatar_decoration",
    productType: 0,
    itemType: 0,
    asset: "buzz-lightyear",
    staticUrl:
      "https://cdn.discordapp.com/avatar-decoration-presets/buzz-lightyear.png?size=240&passthrough=true",
    animatedUrl:
      "https://cdn.discordapp.com/avatar-decoration-presets/buzz-lightyear.png?size=4096&passthrough=true",
  });
  const nameplate = makeCatalogItem({
    id: "nameplate:buzz",
    skuId: "1513664911819931859",
    productId: "1513665079990550618",
    productIds: [bundleProductId],
    name: "Buzz Lightyear",
    kind: "nameplate",
    productType: 0,
    itemType: 2,
    staticUrl: "https://cdn.discordapp.com/assets/collectibles/buzzstatic.png",
    animatedUrl:
      "https://cdn.discordapp.com/assets/collectibles/buzzasset.webm",
    palette: "violet",
  });
  const catalog: CollectiblesCatalog = {
    version: 1,
    source: "cache",
    syncedAt: "2026-07-03T00:00:00.000Z",
    stale: false,
    categories: [],
    items: [bundle, decoration, nameplate],
    counts: {
      avatar_decoration: 1,
      profile_effect: 1,
      nameplate: 1,
      profile_frame: 0,
    },
  };

  it("resolves all bundle constituents from the shared product relationship", () => {
    expect(getBundleConstituentItems(catalog, bundle)).toEqual([
      bundle,
      decoration,
      nameplate,
    ]);
  });

  it("only reports bundles as equipped when every linked collectible is applied", () => {
    const fullyAppliedDisplay = normalizeAvatarDisplay({
      version: 1,
      collectibles: {
        ...collectibleItemToSelection(bundle),
        ...collectibleItemToSelection(decoration),
        ...collectibleItemToSelection(nameplate),
      },
    });
    const effectOnlyDisplay = normalizeAvatarDisplay({
      version: 1,
      collectibles: {
        ...collectibleItemToSelection(bundle),
      },
    });

    expect(isBundleFullyApplied(fullyAppliedDisplay, catalog, bundle)).toBe(
      true,
    );
    expect(isBundleFullyApplied(effectOnlyDisplay, catalog, bundle)).toBe(
      false,
    );
  });
});
