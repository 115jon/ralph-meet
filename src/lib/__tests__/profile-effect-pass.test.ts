import type { ProfileEffectLayer } from "@/lib/avatar-display";
import {
  getProfileEffectPassDeadlineMs,
  getProfileEffectPassLayers,
  getProfileEffectPlaybackSnapshot,
  isProfileEffectPassComplete,
  PROFILE_EFFECT_UNTIMED_LAYER_CAP_MS,
  shouldReplayProfileEffect,
} from "@/lib/profile-effect-playback";
import { describe, expect, it } from "vitest";

// The catalog's common shape: an intro clip, then a looping layer that
// replays every duration + loopDelay (5000 + 2400 here).
const intro: ProfileEffectLayer = {
  src: "https://cdn.example/intro.webm",
  start: 0,
  duration: 3000,
  loop: false,
};
const looping: ProfileEffectLayer = {
  src: "https://cdn.example/loop.webm",
  start: 500,
  duration: 5000,
  loop: true,
  loopDelay: 2400,
};

describe("profile effect pass (play once)", () => {
  it("documents the old cadence: a loop layer re-enters every 7.4s forever", () => {
    const loopMode = getProfileEffectPassLayers([intro, looping], "loop");
    const cycleStarts = [500, 7900, 15_300, 22_700].map(
      (ms) =>
        getProfileEffectPlaybackSnapshot(loopMode, ms + 10).activeLayers.find(
          (state) => state.layer.src === looping.src,
        )?.cycleIndex,
    );
    expect(cycleStarts).toEqual([0, 1, 2, 3]);
  });

  it("plays every looping layer for its first cycle only", () => {
    const once = getProfileEffectPassLayers([intro, looping], "once");
    expect(once.map((layer) => layer.loop)).toEqual([false, false]);

    const replayWindow = getProfileEffectPlaybackSnapshot(once, 7_910);
    expect(replayWindow.activeLayers).toEqual([]);
    expect(replayWindow.nextTransitionMs).toBeNull();
  });

  it("keeps loop mode untouched for the shop stages", () => {
    const layers = [intro, looping];
    expect(getProfileEffectPassLayers(layers, "loop")).toBe(layers);
  });

  it("ends the pass when the last timed layer finishes", () => {
    const once = getProfileEffectPassLayers([intro, looping], "once");
    expect(getProfileEffectPassDeadlineMs(once)).toBe(5_500);
    expect(isProfileEffectPassComplete(once, 0)).toBe(false);
    expect(isProfileEffectPassComplete(once, 5_499)).toBe(false);
    expect(isProfileEffectPassComplete(once, 5_500)).toBe(true);
  });

  it("ends an untimed layer when its media ends, or at the cap", () => {
    const legacy: ProfileEffectLayer[] = [
      { src: "https://cdn.example/legacy.webm", loop: true },
    ];
    const once = getProfileEffectPassLayers(legacy, "once");
    expect(isProfileEffectPassComplete(once, 2_000)).toBe(false);
    expect(isProfileEffectPassComplete(once, 2_000, new Set([0]))).toBe(true);
    expect(
      isProfileEffectPassComplete(once, PROFILE_EFFECT_UNTIMED_LAYER_CAP_MS),
    ).toBe(true);
    expect(getProfileEffectPassDeadlineMs(once)).toBe(
      PROFILE_EFFECT_UNTIMED_LAYER_CAP_MS,
    );
  });

  it("ignores ended reports from timed layers (their timeline decides)", () => {
    const once = getProfileEffectPassLayers([intro, looping], "once");
    expect(isProfileEffectPassComplete(once, 1_000, new Set([0, 1]))).toBe(
      false,
    );
  });

  it("treats no layers as nothing to play", () => {
    expect(isProfileEffectPassComplete([], 0)).toBe(true);
  });

  it("replays only a finished once-pass on a surface that can animate", () => {
    expect(
      shouldReplayProfileEffect({
        mode: "once",
        passComplete: true,
        canAnimate: true,
      }),
    ).toBe(true);
    // Mid-pass: dropped, no restart from frame 0.
    expect(
      shouldReplayProfileEffect({
        mode: "once",
        passComplete: false,
        canAnimate: true,
      }),
    ).toBe(false);
    // Reduced motion or a still card.
    expect(
      shouldReplayProfileEffect({
        mode: "once",
        passComplete: true,
        canAnimate: false,
      }),
    ).toBe(false);
    expect(
      shouldReplayProfileEffect({
        mode: "loop",
        passComplete: true,
        canAnimate: true,
      }),
    ).toBe(false);
  });
});
