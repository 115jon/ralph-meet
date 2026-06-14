import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VoiceGrid } from "@/components/voice/VoiceGrid";
import type { GridItem } from "@/components/voice/types";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

function resetVoiceSettingsStore() {
  useVoiceSettingsStore.setState({ currentUser: null, userSettings: {}, _cache: {} });
}

function setViewerPeerSettings(peerSettings: Record<string, any>) {
  useVoiceSettingsStore.setState({
    currentUser: "viewer",
    userSettings: { viewer: { peerSettings } as any },
    _cache: {},
  });
}

function makeFocusedScreenItem(overrides: Partial<GridItem> = {}): GridItem {
  const liveAudioTrack = { kind: "audio", readyState: "live" } as MediaStreamTrack;

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

function render(items: GridItem[], focusedId: string | null, currentSettings?: any): string {
  return renderToStaticMarkup(
    React.createElement(VoiceGrid, {
      items,
      focusedId,
      onFocus: () => {},
      globalDeafened: false,
      currentSettings: currentSettings ?? { peerSettings: {} },
      watchedStreams: { "user-2": true },
      streamThumbnails: {},
      voiceActions: {},
    }),
  );
}

describe("VoiceGrid focused stage", () => {
  afterEach(() => {
    resetVoiceSettingsStore();
  });

  it("renders an inline stream volume slider for a focused remote stream", () => {
    const markup = render(
      [makeFocusedScreenItem()],
      "remote-screen-user-2",
      { peerSettings: { "user-2": { volume: 135 } } },
    );

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
    const markup = render([
      makeFocusedScreenItem({
        stream: {
          getAudioTracks: () => [],
          getVideoTracks: () => [],
        } as unknown as MediaStream,
      }),
    ], "remote-screen-user-2");

    expect(markup).not.toContain("Stream Volume");
    expect(markup).not.toContain('type="range"');
  });

  it("renders a clean focused stream label without duplicated possessives", () => {
    const markup = render([makeFocusedScreenItem()], "remote-screen-user-2");

    expect(markup).toContain("Alice&#x27;s Stream");
    expect(markup).not.toContain("Alice&#x27;s Stream&#x27;s Screen");
  });

  it("renders a natural local stream label", () => {
    const markup = render([
      makeFocusedScreenItem({
        id: "local-screen-user-1",
        userId: "user-1",
        name: "You",
        isLocal: true,
      }),
    ], "local-screen-user-1");

    expect(markup).toContain("Your Stream");
    expect(markup).not.toContain("You&#x27;s Screen");
  });
});
