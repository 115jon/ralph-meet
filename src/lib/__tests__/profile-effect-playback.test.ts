import type { ProfileEffectSelection } from "@/lib/avatar-display";
import {
  getProfileEffectFallbackAsset,
  getProfileEffectPlaybackSnapshot,
  resolveProfileEffectLayerSource,
} from "@/lib/profile-effect-playback";
import { describe, expect, it } from "vitest";

describe("profile effect playback", () => {
  it("chooses reduced-motion and static fallbacks before animated media", () => {
    const effect: ProfileEffectSelection = {
      skuId: "1516560602187825362",
      name: "Let's Play",
      animationType: 2,
      previewUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/preview",
      thumbnailPreviewSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/thumb",
      reducedMotionSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/reduced",
      staticFrameSrc: "https://cdn.discordapp.com/media/v1/collectibles-shop/static-frame",
      staticUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/static",
      animatedUrl: "https://cdn.discordapp.com/media/v1/collectibles-shop/animated",
      effectUrls: ["https://cdn.discordapp.com/media/v1/collectibles-shop/layer-a"],
      effects: [],
    };

    expect(getProfileEffectFallbackAsset(effect, { playAnimation: true, prefersReducedMotion: true })).toEqual({
      src: "https://cdn.discordapp.com/media/v1/collectibles-shop/reduced",
      kind: "image",
    });

    expect(getProfileEffectFallbackAsset(effect, { playAnimation: false, prefersReducedMotion: false })).toEqual({
      src: "https://cdn.discordapp.com/media/v1/collectibles-shop/static-frame",
      kind: "image",
    });

    expect(getProfileEffectFallbackAsset(effect, { playAnimation: true, prefersReducedMotion: false })).toEqual({
      src: "https://cdn.discordapp.com/media/v1/collectibles-shop/animated",
      kind: "video",
    });
  });

  it("respects intro clips, idle gaps, and loop delays for staggered effects", () => {
    const layers = [
      {
        src: "https://cdn.discordapp.com/media/v1/collectibles-shop/intro",
        loop: false,
        duration: 4904,
        start: 0,
        loopDelay: 0,
        zIndex: 110,
      },
      {
        src: "https://cdn.discordapp.com/media/v1/collectibles-shop/loop",
        loop: true,
        duration: 4906,
        start: 7906,
        loopDelay: 3000,
        zIndex: 100,
      },
    ];

    expect(getProfileEffectPlaybackSnapshot(layers, 0)).toMatchObject({
      activeLayers: [
        {
          layer: { src: "https://cdn.discordapp.com/media/v1/collectibles-shop/intro" },
          cycleIndex: 0,
          activeOffsetMs: 0,
        },
      ],
      nextTransitionMs: 4904,
    });

    expect(getProfileEffectPlaybackSnapshot(layers, 4904)).toMatchObject({
      activeLayers: [],
      nextTransitionMs: 7906,
    });

    expect(getProfileEffectPlaybackSnapshot(layers, 7906)).toMatchObject({
      activeLayers: [
        {
          layer: { src: "https://cdn.discordapp.com/media/v1/collectibles-shop/loop" },
          cycleIndex: 0,
          activeOffsetMs: 0,
        },
      ],
      nextTransitionMs: 12812,
    });

    expect(getProfileEffectPlaybackSnapshot(layers, 15812)).toMatchObject({
      activeLayers: [
        {
          layer: { src: "https://cdn.discordapp.com/media/v1/collectibles-shop/loop" },
          cycleIndex: 1,
          activeOffsetMs: 0,
        },
      ],
      nextTransitionMs: 20718,
    });
  });

  it("allows overlapping layers and recurring delayed loops in the same timeline", () => {
    const layers = [
      {
        src: "https://cdn.discordapp.com/assets/content/intro",
        loop: false,
        duration: 3000,
        start: 0,
        loopDelay: 0,
        zIndex: 100,
      },
      {
        src: "https://cdn.discordapp.com/assets/content/loop",
        loop: true,
        duration: 3000,
        start: 0,
        loopDelay: 3000,
        zIndex: 101,
      },
    ];

    expect(getProfileEffectPlaybackSnapshot(layers, 1500)).toMatchObject({
      activeLayers: [
        { layer: { src: "https://cdn.discordapp.com/assets/content/intro" } },
        { layer: { src: "https://cdn.discordapp.com/assets/content/loop" } },
      ],
      nextTransitionMs: 3000,
    });

    expect(getProfileEffectPlaybackSnapshot(layers, 3000)).toMatchObject({
      activeLayers: [],
      nextTransitionMs: 6000,
    });

    expect(getProfileEffectPlaybackSnapshot(layers, 6000)).toMatchObject({
      activeLayers: [
        {
          layer: { src: "https://cdn.discordapp.com/assets/content/loop" },
          cycleIndex: 1,
          activeOffsetMs: 0,
        },
      ],
      nextTransitionMs: 9000,
    });
  });

  it("keeps seamless loop keys stable so videos are not remounted every cycle", () => {
    const layer = {
      src: "https://cdn.discordapp.com/assets/content/seamless-loop",
      loop: true,
      duration: 3000,
      start: 0,
      loopDelay: 0,
      zIndex: 100,
    };

    const firstCycle = getProfileEffectPlaybackSnapshot([layer], 1500);
    const secondCycle = getProfileEffectPlaybackSnapshot([layer], 3000);

    expect(firstCycle.activeLayers).toHaveLength(1);
    expect(secondCycle.activeLayers).toHaveLength(1);
    expect(secondCycle.activeLayers[0]).toMatchObject({
      cycleIndex: 1,
      activeOffsetMs: 0,
    });
    expect(secondCycle.activeLayers[0].renderKey).toBe(firstCycle.activeLayers[0].renderKey);
  });

  it("resolves randomized sources one variant at a time for each invocation", () => {
    const layer = {
      src: "https://cdn.discordapp.com/assets/content/dice-roll-a",
      loop: true,
      duration: 3250,
      start: 0,
      loopDelay: 0,
      zIndex: 100,
      randomizedSources: [
        { src: "https://cdn.discordapp.com/assets/content/dice-roll-a" },
        { src: "https://cdn.discordapp.com/assets/content/dice-roll-b" },
      ],
    };

    const firstSource = resolveProfileEffectLayerSource(layer, 0, 0);
    const secondSource = resolveProfileEffectLayerSource(layer, 0, 1);
    expect(firstSource).not.toBe(secondSource);

    const snapshot = getProfileEffectPlaybackSnapshot([layer], 0, 1);
    expect(snapshot.activeLayers).toHaveLength(1);
    expect(snapshot.activeLayers[0]).toMatchObject({
      resolvedSrc: secondSource,
      layer: {
        src: "https://cdn.discordapp.com/assets/content/dice-roll-a",
      },
    });
  });
});
