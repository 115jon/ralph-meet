import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VoiceGrid } from "@/components/voice/VoiceGrid";
import {
  fitGrid,
  gridColumnsClass,
  tileAspectClass,
} from "@/components/voice/grid-columns";
import type { GridItem, VoiceActions } from "@/components/voice/types";
import type { StreamWatcherIdentity } from "@/lib/stream-watchers";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

function resetVoiceSettingsStore() {
  useVoiceSettingsStore.setState({
    currentUser: null,
    userSettings: {},
    _cache: {},
  });
}

function setViewerPeerSettings(peerSettings: Record<string, any>) {
  useVoiceSettingsStore.setState({
    currentUser: "viewer",
    userSettings: { viewer: { peerSettings } as any },
    _cache: {},
  });
}

function makeFocusedScreenItem(overrides: Partial<GridItem> = {}): GridItem {
  const liveAudioTrack = {
    kind: "audio",
    readyState: "live",
  } as MediaStreamTrack;

  return {
    id: "remote-screen-user-2",
    userId: "user-2",
    name: "Alice's Stream",
    avatar: null,
    stream: {
      getAudioTracks: () => [liveAudioTrack],
      getVideoTracks: () => [],
    } as unknown as MediaStream,
    isLocal: false,
    type: "screen",
    isStreaming: true,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
    ...overrides,
  };
}

function makeFocusedAvatarItem(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: "avatar-user-2",
    userId: "user-2",
    name: "Alice",
    avatar: "/avatars/alice.png",
    avatarDisplay: null,
    stream: null,
    isLocal: false,
    type: "avatar",
    isStreaming: false,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
    ...overrides,
  };
}

function render(
  items: GridItem[],
  focusedId: string | null,
  currentSettings?: any,
  watchersByStreamer?: Record<string, StreamWatcherIdentity[]>,
  voiceActions: VoiceActions = {},
): string {
  return renderToStaticMarkup(
    React.createElement(VoiceGrid, {
      items,
      focusedId,
      onFocus: () => {},
      globalDeafened: false,
      currentSettings: currentSettings ?? { peerSettings: {} },
      watchedStreams: { "user-2": true },
      streamThumbnails: {},
      voiceActions: {
        ...voiceActions,
        ...(watchersByStreamer ? { watchersByStreamer } : {}),
      },
    }),
  );
}

describe("VoiceGrid focused stage", () => {
  afterEach(() => {
    resetVoiceSettingsStore();
  });

  it("renders an inline stream volume slider for a focused remote stream", () => {
    const markup = render([makeFocusedScreenItem()], "remote-screen-user-2", {
      peerSettings: { "user-2": { volume: 135 } },
    });

    expect(markup).toContain("Stream volume");
    expect(markup).toContain('type="range"');
  });

  it("uses the stream-specific volume for a focused remote stream", () => {
    setViewerPeerSettings({
      "user-2": {
        volume: 25,
        streamVolume: 145,
        muted: false,
        alwaysHear: false,
        attenuationEnabled: false,
        attenuationStrength: 50,
        soundboardMuted: false,
      },
    });

    const markup = render([makeFocusedScreenItem()], "remote-screen-user-2");

    expect(markup).toContain("Stream volume");
    expect(markup).toContain('value="145"');
  });

  it("hides the stream volume slider for a focused remote stream without audio", () => {
    const markup = render(
      [
        makeFocusedScreenItem({
          stream: {
            getAudioTracks: () => [],
            getVideoTracks: () => [],
          } as unknown as MediaStream,
        }),
      ],
      "remote-screen-user-2",
    );

    expect(markup).not.toContain("Stream volume");
    expect(markup).not.toContain('type="range"');
  });

  it("renders a clean focused stream label without duplicated possessives", () => {
    const markup = render([makeFocusedScreenItem()], "remote-screen-user-2");

    expect(markup).toContain("Alice&#x27;s Stream");
    expect(markup).not.toContain("Alice&#x27;s Stream&#x27;s Screen");
  });

  it("renders a natural local stream label", () => {
    const markup = render(
      [
        makeFocusedScreenItem({
          id: "local-screen-user-1",
          userId: "user-1",
          name: "You",
          isLocal: true,
        }),
      ],
      "local-screen-user-1",
    );

    expect(markup).toContain("Your stream");
    expect(markup).not.toContain("You&#x27;s Screen");
  });

  it("does not render watcher identities inside the focused stage overlay", () => {
    const markup = render(
      [makeFocusedScreenItem()],
      "remote-screen-user-2",
      undefined,
      {
        "user-2": [
          { userId: "user-3", name: "Bob", avatar: null, isLocal: false },
          { userId: "user-4", name: "Carla", avatar: null, isLocal: false },
        ],
      },
    );

    expect(markup).not.toContain("2 viewers");
    expect(markup).not.toContain("Bob, Carla");
  });

  it("renders the focused avatar as a square avatar, never stretched, without crop or decoration overlays", () => {
    const markup = render(
      [
        makeFocusedAvatarItem({
          avatarDisplay: {
            version: 1,
            crop: { x: 25, y: 25, width: 50, height: 50 },
            collectibles: {
              avatarDecoration: {
                skuId: "decor-1",
                name: "Glow",
                asset: "decor/glow",
                imageUrl:
                  "https://cdn.discordapp.com/avatar-decoration-presets/glow.png",
              },
            },
          },
        }),
      ],
      "avatar-user-2",
    );

    expect(markup).toContain("avatars/alice.png");
    // The picture is an 80px square key on the tinted stage, not object-contain
    // across a 16:9 frame (an upscaled, blurry profile picture).
    // (The Avatar primitive at 80: a size-20 box with 2px corners, the image
    // covering it and inheriting them.)
    expect(markup).toMatch(
      /data-slot="avatar" class="[^"]*rounded-avatar[^"]* size-20 [^"]*"[^>]*><img[^>]*class="size-full rounded-\[inherit\] object-cover"/,
    );
    expect(markup).not.toMatch(/data-slot="avatar" class="[^"]*rounded-full/);
    expect(markup).not.toMatch(/alice\.png"[^>]*object-contain/);
    expect(markup).not.toContain("avatar-decoration-presets/glow.png");
    expect(markup).not.toContain("left:-50%");
    expect(markup).not.toContain("width:200%");
  });

  it("keeps the focused avatar visual layer from intercepting clear-focus clicks", () => {
    const markup = render([makeFocusedAvatarItem()], "avatar-user-2");

    // The visual layer sits inside a pointer-events-none wrapper, so a click
    // anywhere on the stage reaches the clear-focus button underneath.
    expect(markup).toMatch(
      /class="pointer-events-none[^"]*"><div data-focused-visual="true"/,
    );
  });

  it("keeps the local preview toggle available in the focused stage", () => {
    const markup = render(
      [
        makeFocusedScreenItem({
          id: "local-screen-user-1",
          userId: "user-1",
          name: "You",
          isLocal: true,
          stream: null,
        }),
      ],
      "local-screen-user-1",
      undefined,
      undefined,
      {
        isPreviewHidden: true,
        togglePreviewHidden: () => {},
      },
    );

    expect(markup).toContain('data-focused-stage="true"');
    expect(markup).toContain('data-preview-toggle="true"');
    expect(markup).toContain("Resume preview");
  });
});

describe("VoiceGrid scroll and columns", () => {
  const avatars = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      makeFocusedAvatarItem({ id: `a-${i}`, userId: `u-${i}`, avatar: null }),
    );

  it("starts an overflowing grid at the top instead of centring it off-screen", () => {
    const markup = render(avatars(6), null);
    // `safe center` centres a short grid and falls back to start once the
    // tiles overflow, so the first rows stay reachable (VC-21).
    expect(markup).toContain("place-content-[safe_center]");
    expect(markup).not.toMatch(/place-content-center(?![-\w])/);
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("overscroll-contain");
    // Rows size to the 16:9 tiles rather than squashing them into the box.
    expect(markup).toContain("auto-rows-max");
    // The scrollbar is no longer hidden three ways.
    expect(markup).not.toContain("scrollbar-hide");
    expect(markup).not.toContain("no-scrollbar");
  });

  it("uses the spec insets: 8px gaps and a 16px stage inset at every size", () => {
    const markup = render(avatars(3), null);
    for (const token of ["gap-2", "p-4"]) {
      expect(markup).toContain(token);
    }
    expect(markup).not.toContain("md:gap-3");
    expect(markup).not.toContain("pt-20");
  });

  it("fits nine tiles into a 1280x720 stage without scrolling", () => {
    // 1280x720 window: 60 rail + 264 tree, 24 titlebar + 48 header + 57
    // stage bar, minus the 16px stage inset on each side.
    const fit = fitGrid(1280 - 60 - 264 - 32, 720 - 24 - 48 - 57 - 32, 9);
    expect(fit.scrolls).toBe(false);
    expect(fit.cols).toBe(3);
    const rows = Math.ceil(9 / fit.cols);
    const height = rows * ((fit.tileW * 9) / 16) + (rows - 1) * 8;
    expect(height).toBeLessThanOrEqual(720 - 24 - 48 - 57 - 32);
  });

  it("fits by height as well as width and scrolls only under 200px tiles", () => {
    // A wide, short stage: two people side by side, not stacked.
    expect(fitGrid(1200, 300, 2).cols).toBe(2);
    // A tall, narrow stage (wider than a phone): stacked.
    expect(fitGrid(600, 1400, 2).cols).toBe(1);
    expect(fitGrid(600, 1400, 2).aspect).toBe("video");
    // One person is capped at 640 wide.
    expect(fitGrid(1600, 1000, 1).tileW).toBe(640);
    // Thirty people in a small box: tiles stay legible and the grid scrolls.
    const crowd = fitGrid(800, 400, 30);
    expect(crowd.scrolls).toBe(true);
    expect(crowd.tileW).toBeGreaterThanOrEqual(200);
  });

  it("fits 2–4 people on a phone to the stage's height with no scrolling", () => {
    // 390x844 phone: 16px stage inset each side; 48 header, 72 stage bar,
    // 56 tab bar off the height.
    const width = 390 - 32;
    const height = 844 - 48 - 72 - 56 - 32;
    for (const count of [2, 3, 4]) {
      const fit = fitGrid(width, height, count);
      const cols = count === 2 ? 1 : 2;
      expect(fit).toMatchObject({ cols, aspect: "fill", scrolls: false });
      const rows = Math.ceil(count / cols);
      // The rows fill the height and the columns the width, 8px apart:
      // nothing is left empty above or below the grid.
      const gridH = rows * fit.tileH! + (rows - 1) * 8;
      expect(gridH).toBeLessThanOrEqual(height);
      expect(height - gridH).toBeLessThan(rows);
      const gridW = cols * fit.tileW + (cols - 1) * 8;
      expect(gridW).toBeLessThanOrEqual(width);
      expect(width - gridW).toBeLessThan(cols);
    }
    // One person, or five and more, keep 16:9.
    expect(fitGrid(width, height, 1).aspect).toBe("video");
    expect(fitGrid(width, height, 5).aspect).toBe("video");
    // From 560px wide the stage is not a phone.
    expect(fitGrid(560, height, 4).aspect).toBe("video");
    expect(tileAspectClass(fitGrid(width, height, 3), 3)).toBe("aspect-auto");
    expect(tileAspectClass(fitGrid(1000, 600, 3), 3)).toBeUndefined();
    // Before the first measurement, a container query picks a portrait tile.
    expect(tileAspectClass(null, 3)).toBe("@max-[559px]:aspect-3/4");
    expect(tileAspectClass(null, 6)).toBeUndefined();
  });

  it("falls back to columns from the stage's own width before measuring", () => {
    expect(gridColumnsClass(1)).toContain("grid-cols-1");
    expect(gridColumnsClass(4)).toBe("grid-cols-2");
    expect(gridColumnsClass(6)).toContain("@min-[800px]:grid-cols-3");
    expect(gridColumnsClass(12)).toContain("@min-[1200px]:grid-cols-4");
    for (const count of [1, 4, 9, 16, 30]) {
      // Container queries only; no viewport breakpoints in the stage.
      expect(gridColumnsClass(count)).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    }
  });
});
