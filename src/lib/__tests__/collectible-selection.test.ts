import { collectibleItemToSelection } from "@/lib/collectible-selection";
import type { CollectibleCatalogItem } from "@/lib/collectibles-catalog";
import { describe, expect, it } from "vitest";

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
      previewUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/preview",
      staticUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static",
      animatedUrl: "https://cdn.discordapp.com/assets/content/dice-roll-a",
      profileEffect: {
        animationType: 2,
        thumbnailPreviewSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/thumb",
        reducedMotionSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/reduced",
        staticFrameSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/frame",
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
        previewUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/preview",
        thumbnailPreviewSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/thumb",
        reducedMotionSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/reduced",
        staticFrameSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/frame",
        staticUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static",
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
});
