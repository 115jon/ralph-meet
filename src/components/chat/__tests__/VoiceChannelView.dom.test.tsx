// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import VoiceChannelView from "@/components/chat/VoiceChannelView";
import { useVoiceChannel } from "@/hooks/useVoiceChannel";

vi.mock("@/hooks/useVoiceChannel", () => ({
  useVoiceChannel: vi.fn(),
}));

vi.mock("@/stores/useVoiceActivityStore", () => ({
  isVoiceActivityType: () => false,
  useVoiceActivityStore: (
    selector: (state: {
      getUserActivity: () => null;
      setUserActivity: () => void;
      clearUserActivity: () => void;
    }) => unknown,
  ) =>
    selector({
      getUserActivity: () => null,
      setUserActivity: () => {},
      clearUserActivity: () => {},
    }),
}));

vi.mock("@/components/voice/ParticipantCard", () => ({
  ParticipantCard: () => null,
}));

vi.mock("@/components/voice/VoiceControls", () => ({
  VoiceControls: () => null,
}));

vi.mock("@/components/voice/VoiceGrid", () => ({
  VoiceGrid: () => <div data-testid="voice-grid" />,
}));

vi.mock("@/components/voice/VoiceHeader", () => ({
  VoiceHeader: () => null,
}));

vi.mock("@/components/voice/VoiceLanding", () => ({
  VoiceLanding: () => null,
}));

vi.mock("@/components/UnifiedScreenShareModal", () => ({
  UnifiedScreenShareModal: () => null,
}));

vi.mock("@/components/chat/WordleActivityStage", () => ({
  default: () => null,
}));

vi.mock("@/components/chat/WarpRushActivityStage", () => ({
  default: () => null,
}));

const mockedUseVoiceChannel = vi.mocked(useVoiceChannel);

function makeHookState(overrides: Record<string, unknown> = {}) {
  return {
    joined: true,
    isScreenSharing: true,
    isStreamingAudio: false,
    currentScreenQuality: "720p30",
    currentScreenSource: null,
    isCameraActive: false,
    connectionState: "connected",
    focusedId: null,
    setFocusedId: vi.fn(),
    watchedStreams: {},
    streamThumbnails: {},
    gridItems: [
      {
        id: "local-screen-user-1",
        userId: "user-1",
        name: "You",
        avatar: null,
        avatarDisplay: null,
        stream: null,
        isLocal: true,
        type: "screen",
        isStreaming: true,
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
      },
    ],
    watchersByStreamer: {},
    handleJoin: vi.fn(),
    handleLeave: vi.fn(),
    toggleMic: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(),
    onToggleStreamAudio: vi.fn(),
    onToggleWatch: vi.fn(),
    currentSettings: {},
    isMicOn: true,
    isDeafened: false,
    isCameraOn: false,
    vcMembers: [],
    hasMicrophone: true,
    hasCamera: true,
    sfu: null,
    spatialAudioState: { updatedAt: 123 },
    updateSharedSpatialAudioState: vi.fn(),
    settingsUserId: "user-1",
    roomSlug: "voice-server-1-channel-1",
    voiceSessionId: "session-1",
    togglePreviewHidden: vi.fn(),
    isPreviewHidden: false,
    alwaysShowStreamPreview: false,
    onToggleAlwaysShowStreamPreview: vi.fn(),
    ...overrides,
  };
}

describe("VoiceChannelView stream snapshot export", () => {
  beforeEach(() => {
    mockedUseVoiceChannel.mockReset();
  });

  it("re-emits the snapshot when menu action callbacks change without a visible state hash change", async () => {
    const firstToggleScreenShare = vi.fn();
    const firstToggleAlwaysShow = vi.fn();
    let hookState = makeHookState({
      toggleScreenShare: firstToggleScreenShare,
      onToggleAlwaysShowStreamPreview: firstToggleAlwaysShow,
    });
    mockedUseVoiceChannel.mockImplementation(() => hookState as never);

    const onStreamStateUpdate = vi.fn();
    const view = render(
      <VoiceChannelView
        channelId="channel-1"
        channelName="General"
        serverId="server-1"
        onToggleTextChat={() => {}}
        showTextChat={false}
        onStreamStateUpdate={onStreamStateUpdate}
      />,
    );

    await waitFor(() => expect(onStreamStateUpdate).toHaveBeenCalledTimes(1));
    onStreamStateUpdate.mock.calls[0]?.[0].toggleScreenShare();
    expect(firstToggleScreenShare).toHaveBeenCalledTimes(1);
    expect(
      onStreamStateUpdate.mock.calls[0]?.[0].onToggleAlwaysShowStreamPreview,
    ).toBe(firstToggleAlwaysShow);

    const secondToggleScreenShare = vi.fn();
    const secondToggleAlwaysShow = vi.fn();
    hookState = makeHookState({
      toggleScreenShare: secondToggleScreenShare,
      onToggleAlwaysShowStreamPreview: secondToggleAlwaysShow,
    });
    mockedUseVoiceChannel.mockImplementation(() => hookState as never);

    view.rerender(
      <VoiceChannelView
        channelId="channel-1"
        channelName="General"
        serverId="server-1"
        onToggleTextChat={() => {}}
        showTextChat={false}
        onStreamStateUpdate={onStreamStateUpdate}
      />,
    );

    await waitFor(() => expect(onStreamStateUpdate).toHaveBeenCalledTimes(2));
    onStreamStateUpdate.mock.calls[1]?.[0].toggleScreenShare();
    expect(secondToggleScreenShare).toHaveBeenCalledTimes(1);
    expect(
      onStreamStateUpdate.mock.calls[1]?.[0].onToggleAlwaysShowStreamPreview,
    ).toBe(secondToggleAlwaysShow);
  });
});
