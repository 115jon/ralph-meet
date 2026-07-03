import {
  avatarDisplayToImageStyle,
  normalizeAvatarDisplay,
  serializeAvatarDisplay,
} from "@/lib/avatar-display";
import { describe, expect, it } from "vitest";

describe("avatar display metadata", () => {
  it("normalizes valid crop instructions and rejects unsafe values", () => {
    expect(
      normalizeAvatarDisplay({
        version: 1,
        crop: { x: 12.3456, y: 0, width: 75.5555, height: 75.5555 },
      }),
    ).toEqual({
      version: 1,
      crop: { x: 12.35, y: 0, width: 75.56, height: 75.56 },
    });

    expect(normalizeAvatarDisplay({ version: 2, crop: { x: 0, y: 0, width: 50, height: 50 } })).toBeNull();
    expect(normalizeAvatarDisplay({ version: 1, crop: { x: -1, y: 0, width: 50, height: 50 } })).toBeNull();
    expect(normalizeAvatarDisplay({ version: 1, crop: { x: 60, y: 0, width: 50, height: 50 } })).toBeNull();
    expect(normalizeAvatarDisplay("not-json")).toBeNull();
  });

  it("normalizes collectible selections without requiring a crop", () => {
    expect(
      normalizeAvatarDisplay({
        version: 1,
        collectibles: {
          avatarDecoration: {
            skuId: "123",
            name: "Spark Ring",
            asset: "a_deadbeef",
            imageUrl: "https://cdn.discordapp.com/avatar-decoration-presets/a_deadbeef.png?size=240&passthrough=true",
          },
          profileEffect: {
            skuId: "456",
            name: "Glow",
            previewUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static",
            effectUrls: ["https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer"],
          },
        },
      }),
    ).toEqual({
      version: 1,
      collectibles: {
        avatarDecoration: {
          skuId: "123",
          name: "Spark Ring",
          asset: "a_deadbeef",
          imageUrl: "https://cdn.discordapp.com/avatar-decoration-presets/a_deadbeef.png?size=240&passthrough=true",
        },
        profileEffect: {
          skuId: "456",
          name: "Glow",
          previewUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static",
          effectUrls: ["https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer"],
        },
      },
    });

    expect(
      normalizeAvatarDisplay({
        version: 1,
        collectibles: {
          avatarDecoration: {
            skuId: "123",
            name: "Bad URL",
            asset: "a_deadbeef",
            imageUrl: "https://example.com/a.png",
          },
        },
      }),
    ).toBeNull();
  });

  it("preserves layered profile effect metadata for animated previews", () => {
    expect(
      normalizeAvatarDisplay({
        version: 1,
        collectibles: {
          profileEffect: {
            skuId: "789",
            name: "Cycling Lights",
            animationType: 2,
            previewUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/preview",
            thumbnailPreviewSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/thumb",
            reducedMotionSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/reduced",
            staticFrameSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static-frame",
            effects: [
              {
                src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-a",
                zIndex: 4,
                loop: true,
                duration: 4906,
                start: 7906,
                loopDelay: 3000,
                width: 450,
                height: 880,
                position: {
                  x: 0,
                  y: 0,
                },
                randomizedSources: [
                  {
                    src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-a",
                  },
                  {
                    src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-b",
                  },
                ],
              },
              {
                src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-b",
                zIndex: 8,
              },
            ],
          },
        },
      }),
    ).toEqual({
      version: 1,
      collectibles: {
        profileEffect: {
          skuId: "789",
          name: "Cycling Lights",
          animationType: 2,
          previewUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/preview",
          thumbnailPreviewSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/thumb",
          reducedMotionSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/reduced",
          staticFrameSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/static-frame",
          effectUrls: [
            "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-a",
            "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-b",
          ],
          effects: [
            {
              src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-a",
              zIndex: 4,
              loop: true,
              duration: 4906,
              start: 7906,
              loopDelay: 3000,
              width: 450,
              height: 880,
              position: {
                x: 0,
                y: 0,
              },
              randomizedSources: [
                {
                  src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-a",
                },
                {
                  src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-b",
                },
              ],
            },
            {
              src: "https://cdn.discordapp.com/media/v1/collectibles-shop/effect/layer-b",
              zIndex: 8,
            },
          ],
        },
      },
    });
  });

  it("serializes metadata for storage and produces layout styles for square avatar renderers", () => {
    const display = {
      version: 1 as const,
      crop: { x: 25, y: 10, width: 50, height: 50 },
    };

    expect(serializeAvatarDisplay(display)).toBe(JSON.stringify(display));
    expect(avatarDisplayToImageStyle(display)).toMatchObject({
      position: "absolute",
      left: "-50%",
      top: "-20%",
      width: "200%",
      height: "200%",
      maxWidth: "none",
      maxHeight: "none",
      objectFit: "fill",
    });
  });
});
