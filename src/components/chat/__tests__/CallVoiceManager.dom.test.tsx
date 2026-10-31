// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reset: vi.fn(),
  update: vi.fn(),
  togglePreviewHidden: vi.fn(),
  voice: {
    sfu: null,
    joined: true,
    connectionState: "connected",
    isCameraActive: false,
    isScreenSharing: true,
    isStreamingAudio: false,
    currentScreenQuality: "720p30",
    currentScreenSource: null,
    hasCamera: true,
    hasMicrophone: true,
    audioBlocked: false,
    gridItems: [],
    roomSlug: "dm-call-user-1-user-2",
    voiceSessionId: "session-1",
    streamThumbnails: {},
    watchedStreams: {},
    watchersByStreamer: {},
    focusedId: null,
    isMicOn: true,
    isDeafened: false,
    togglePreviewHidden: vi.fn(),
    isPreviewHidden: true,
    handleLeave: vi.fn(),
    toggleMic: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(),
    onToggleStreamAudio: vi.fn(),
    onToggleWatch: vi.fn(),
    setFocusedId: vi.fn(),
    updateSharedSpatialAudioState: vi.fn(),
  },
  callState: {
    status: "active",
    voiceRoomId: "dm-call-user-1-user-2",
    channelId: "channel-1",
    hasJoinedSFU: true,
  },
}));

mocks.voice.togglePreviewHidden = mocks.togglePreviewHidden;

vi.mock("@/hooks/useVoiceChannel", () => ({
  useVoiceChannel: () => mocks.voice,
}));

vi.mock("@/stores/useCallStore", () => ({
  useCallStore: (selector: (state: typeof mocks.callState) => unknown) =>
    selector(mocks.callState),
}));

vi.mock("@/stores/useCallVoiceStore", () => ({
  useCallVoiceStore: {
    getState: () => ({ reset: mocks.reset, update: mocks.update }),
  },
}));

vi.mock("@/components/chat/VoiceMediaManager", () => ({
  VoiceMediaManager: () => null,
}));

import { CallVoiceManager } from "@/components/chat/CallVoiceManager";

describe("CallVoiceManager preview state bridge", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.reset.mockReset();
  });

  it("syncs preview state and its toggle callback into the DM voice store", async () => {
    render(<CallVoiceManager />);

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          isPreviewHidden: true,
        }),
      );
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          togglePreviewHidden: mocks.togglePreviewHidden,
        }),
      );
    });
  });
});
