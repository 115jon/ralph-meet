// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceActions } from "@/components/voice/types";

const mocks = vi.hoisted(() => {
  const togglePreviewHidden = vi.fn();
  const voiceGrid = vi.fn(() => null);
  const callVoice = {
    sfu: null,
    joined: true,
    connectionState: "connected",
    isCameraActive: false,
    isScreenSharing: true,
    isStreamingAudio: false,
    screenQuality: "720p30",
    currentScreenSource: null,
    hasCamera: true,
    hasMicrophone: true,
    audioBlocked: false,
    gridItems: [
      {
        id: "local-screen-1",
        userId: "user-1",
        name: "You",
        avatar: null,
        avatarDisplay: null,
        stream: null,
        isLocal: true,
        type: "screen" as const,
        isStreaming: true,
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
      },
    ],
    roomSlug: "dm-call-user-1-user-2",
    voiceSessionId: "session-1",
    streamThumbnails: {},
    watchedStreams: {},
    watchersByStreamer: {},
    focusedId: "local-screen-1",
    isMicOn: true,
    isDeafened: false,
    togglePreviewHidden,
    isPreviewHidden: true,
    handleLeave: vi.fn(),
    toggleMic: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(),
    onToggleStreamAudio: vi.fn(),
    onToggleWatch: vi.fn(),
    setFocusedId: vi.fn(),
  };

  return {
    callVoice,
    currentUser: { id: "user-1" },
    voiceGrid,
    togglePreviewHidden,
    callStore: {
      status: "active",
      callId: "call-1",
      remoteUser: { id: "user-2" },
      channelId: "channel-1",
      hasConnected: true,
      hasJoinedSFU: true,
      voiceRoomId: "dm-call-user-1-user-2",
      joinSFU: vi.fn(),
      endCall: vi.fn(),
    },
    chatState: {
      gateway: null,
      user: { id: "user-1" },
      voiceChannelStates: {
        "channel-1": [{ clerk_user_id: "user-1" }],
      },
      dmChannels: [
        {
          id: "channel-1",
          recipient: { id: "user-2" },
        },
      ],
    },
  };
});

vi.mock("@/stores/useCallStore", () => {
  const useCallStore = Object.assign(() => mocks.callStore, {
    getState: () => mocks.callStore,
    setState: vi.fn(),
  });
  return { useCallStore };
});

vi.mock("@/stores/useCallVoiceStore", () => {
  const useCallVoiceStore = Object.assign(() => mocks.callVoice, {
    getState: () => mocks.callVoice,
    subscribe: () => () => {},
  });
  return { useCallVoiceStore };
});

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: typeof mocks.chatState) => unknown) =>
    selector(mocks.chatState),
}));

vi.mock("@/stores/useVoiceSettingsStore", () => ({
  useVoiceSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ getSettings: () => ({ isMuted: false }) }),
}));

vi.mock("@/hooks/useUserResolution", () => ({
  useUserResolution: () => ({
    displayName: "User",
    username: "user",
    avatarUrl: "",
    avatarDisplay: null,
  }),
}));

vi.mock("@/components/voice/VoiceGrid", () => ({
  VoiceGrid: mocks.voiceGrid,
}));

vi.mock("@/components/voice/VoiceControls", () => ({
  VoiceControls: () => null,
}));

vi.mock("@/components/UnifiedScreenShareModal", () => ({
  UnifiedScreenShareModal: () => null,
}));

vi.mock("@/lib/sounds", () => ({
  playCallEnd: vi.fn(),
  playRingStop: vi.fn(),
  resumeSoundContext: vi.fn(),
}));

vi.mock("@/lib/voice/audio-pipeline", () => ({
  disposePrewarmedAudioContext: vi.fn(),
  prewarmAudioContext: vi.fn(),
}));

vi.mock("@/lib/voice/utils", () => ({
  getAvailableStreamQualities: () => [],
}));

vi.mock("@/lib/voice-presence", () => ({
  isVoiceMemberReconnecting: () => false,
}));

import { DMCallRegion } from "@/components/chat/DMCallRegion";

describe("DMCallRegion preview actions", () => {
  beforeEach(() => {
    mocks.voiceGrid.mockClear();
  });

  it("forwards the preview state and toggle callback to VoiceGrid", async () => {
    render(<DMCallRegion channelId="channel-1" />);

    await waitFor(() => expect(mocks.voiceGrid).toHaveBeenCalled());

    const props = mocks.voiceGrid.mock.calls[0]?.[0] as {
      voiceActions?: VoiceActions;
    };
    expect(props.voiceActions?.isPreviewHidden).toBe(true);
    expect(props.voiceActions?.togglePreviewHidden).toBe(
      mocks.togglePreviewHidden,
    );
  });
});
