// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNextDesktopMediaControls } from "../DesktopThumbnailToolbarSync";

const mocks = vi.hoisted(() => {
  type ToolbarAction = "toggle-media-playback";
  return {
    listener: null as
      | ((event: { action: ToolbarAction }) => void | Promise<void>)
      | null,
    livePosition: vi.fn(() => 12_000),
    sendAppEvent: vi.fn(),
    setLocalPlayback: vi.fn(),
    syncToolbar: vi.fn(async () => {}),
  };
});

vi.mock("@/components/CameraSettingsModal", () => ({
  CameraSettingsModal: () => null,
}));
vi.mock("@/lib/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host")>();
  return {
    ...actual,
    getHost: () => ({
      ...actual.getHost(),
      window: {
        ...actual.getHost().window,
        onThumbnailToolbarAction: vi.fn(
          async (
            handler: (event: {
              action: "toggle-media-playback";
            }) => void | Promise<void>,
          ) => {
            mocks.listener = handler;
            return vi.fn();
          },
        ),
        syncThumbnailToolbar: mocks.syncToolbar,
      },
    }),
  };
});
vi.mock("@/lib/sounds", () => ({ playCallEnd: vi.fn() }));
vi.mock("@/lib/voice/camera-toggle", () => ({
  handleVoiceCameraToggle: vi.fn(),
}));
vi.mock("@/stores/useCallStore", () => ({
  useCallStore: (selector: (state: unknown) => unknown) =>
    selector({
      endCall: vi.fn(),
      hasJoinedSFU: true,
      status: "active",
    }),
}));
vi.mock("@/stores/useCallVoiceStore", () => ({
  useCallVoiceStore: (selector: (state: unknown) => unknown) =>
    selector({
      handleLeave: vi.fn(),
      hasCamera: false,
      hasMicrophone: true,
      isCameraActive: false,
      isDeafened: false,
      isMicOn: true,
      roomSlug: "room-1",
      sfu: {
        resumeAudioContext: vi.fn(),
        voiceGW: {
          isReady: true,
          sendAppEvent: mocks.sendAppEvent,
        },
      },
      toggleCamera: null,
      toggleDeafen: vi.fn(),
      toggleMic: vi.fn(),
    }),
}));
vi.mock("@/stores/useVoiceSettingsStore", () => ({
  useVoiceSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ getSettings: () => ({ alwaysPreviewVideo: false }) }),
}));
vi.mock("../listen-together-playback", () => ({
  getListenTogetherLivePositionMs: mocks.livePosition,
  useListenTogetherPlaybackState: () => {
    return {
      currentEntry: { entryId: "entry-1" },
      effectiveSeekValue: 12_000,
      isPaused: false,
      localPlayback: null,
      setLocalPlayback: mocks.setLocalPlayback,
      snapshot: { revision: 4 },
    };
  },
}));

import { DesktopThumbnailToolbarSync } from "../DesktopThumbnailToolbarSync";

describe("DesktopThumbnailToolbarSync media controls", () => {
  beforeEach(() => {
    mocks.listener = null;
    mocks.sendAppEvent.mockReset();
    mocks.setLocalPlayback.mockReset();
    mocks.syncToolbar.mockReset().mockResolvedValue(undefined);
    mocks.livePosition.mockReset().mockReturnValue(12_000);
  });

  it("pins a pause at the live position", async () => {
    mocks.sendAppEvent.mockReturnValue(true);
    render(
      <DesktopThumbnailToolbarSync
        currentUserId="user-1"
        localStreamState={null}
        voiceJoined={false}
      />,
    );
    await waitFor(() => expect(mocks.listener).not.toBeNull());

    mocks.livePosition.mockReturnValue(47_500);
    await act(async () => {
      await mocks.listener?.({ action: "toggle-media-playback" });
    });
    expect(mocks.setLocalPlayback).toHaveBeenLastCalledWith(
      "room-1",
      expect.objectContaining({ paused: true, positionMs: 47_500 }),
    );
  });

  it("inverts the latest optimistic state and preserves ordered pending toggles", () => {
    const initial = {
      entryId: "entry-1",
      paused: false,
      positionMs: 12_000,
      localPlayback: null,
      snapshotRevision: 4,
      roomSlug: "room-1",
      setLocalPlayback: vi.fn(),
      sfu: { voiceGW: { sendAppEvent: vi.fn() } } as never,
    };

    const firstToggle = getNextDesktopMediaControls(initial);
    const secondToggle = getNextDesktopMediaControls(firstToggle);

    expect(firstToggle.paused).toBe(true);
    expect(secondToggle.paused).toBe(false);
    expect(secondToggle.localPlayback).toMatchObject({
      paused: false,
      entryId: "entry-1",
      source: "command",
      pendingStates: [
        {
          paused: true,
          positionMs: 12_000,
          snapshotRevision: 4,
          sequence: 1,
        },
        {
          paused: false,
          positionMs: 12_000,
          snapshotRevision: 5,
          sequence: 2,
        },
      ],
    });
  });

  it("uses the synchronous ref for accepted rapid toggles", async () => {
    mocks.sendAppEvent.mockReturnValue(true);
    render(
      <DesktopThumbnailToolbarSync
        currentUserId="user-1"
        localStreamState={null}
        voiceJoined={false}
      />,
    );
    await waitFor(() => expect(mocks.listener).not.toBeNull());

    await act(async () => {
      await mocks.listener?.({ action: "toggle-media-playback" });
      await mocks.listener?.({ action: "toggle-media-playback" });
    });

    expect(mocks.sendAppEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ paused: true }),
    );
    expect(mocks.sendAppEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ paused: false }),
    );
    expect(mocks.setLocalPlayback).toHaveBeenLastCalledWith(
      "room-1",
      expect.objectContaining({
        paused: false,
        pendingStates: [
          expect.objectContaining({ paused: true, sequence: 1 }),
          expect.objectContaining({ paused: false, sequence: 2 }),
        ],
      }),
    );
  });

  it("does not advance the ref after a rejected toggle", async () => {
    mocks.sendAppEvent.mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(
      <DesktopThumbnailToolbarSync
        currentUserId="user-1"
        localStreamState={null}
        voiceJoined={false}
      />,
    );
    await waitFor(() => expect(mocks.listener).not.toBeNull());

    await act(async () => {
      await mocks.listener?.({ action: "toggle-media-playback" });
      await mocks.listener?.({ action: "toggle-media-playback" });
    });

    expect(mocks.sendAppEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ paused: true }),
    );
    expect(mocks.sendAppEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ paused: true }),
    );
    expect(mocks.setLocalPlayback).toHaveBeenCalledTimes(1);
  });
});
