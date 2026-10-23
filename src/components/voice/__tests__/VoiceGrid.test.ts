import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VoiceGrid } from "@/components/voice/VoiceGrid";
import { gridColumnsClass } from "@/components/voice/grid-columns";
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

    expect(markup).toContain("Stream Volume");
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

    expect(markup).toContain("Stream Volume");
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

    expect(markup).not.toContain("Stream Volume");
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

    expect(markup).toContain("Your Stream");
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

  it("renders the focused avatar stage from the raw source without crop or decoration overlays", () => {
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
    expect(markup).toContain("object-contain");
    expect(markup).not.toContain("avatar-decoration-presets/glow.png");
    expect(markup).not.toContain("left:-50%");
    expect(markup).not.toContain("width:200%");
  });

  it("keeps the focused avatar visual layer from intercepting clear-focus clicks", () => {
    const markup = render([makeFocusedAvatarItem()], "avatar-user-2");

    expect(markup).toMatch(
      /data-focused-visual="true"[^>]*class="[^"]*pointer-events-none/,
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

  it("uses the spec insets: gap-2/p-4 on phones, gap-3/p-6 from md", () => {
    const markup = render(avatars(3), null);
    for (const token of ["gap-2", "md:gap-3", "p-4", "md:p-6"]) {
      expect(markup).toContain(token);
    }
    expect(markup).not.toContain("pt-20");
  });

  it("picks columns from the stage's own width, capped by head count", () => {
    expect(gridColumnsClass(1)).toContain("grid-cols-1");
    expect(gridColumnsClass(4)).toBe("grid-cols-1 @min-[560px]:grid-cols-2");
    expect(gridColumnsClass(6)).toContain("@min-[1000px]:grid-cols-3");
    expect(gridColumnsClass(12)).toContain("@min-[1200px]:grid-cols-4");
    for (const count of [1, 4, 9, 16, 30]) {
      // Container queries only; no viewport breakpoints in the stage.
      expect(gridColumnsClass(count)).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    }
  });
});
