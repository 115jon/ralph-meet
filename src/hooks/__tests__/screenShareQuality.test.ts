import { describe, expect, it, vi } from "vitest";
import {
  applyScreenSenderQuality,
  canUpdateExistingScreenStreamInPlace,
  shouldRenderRemoteScreenTile,
} from "@/hooks/useVoiceChannel";

describe("canUpdateExistingScreenStreamInPlace", () => {
  it("keeps audio-only updates on the in-place path", () => {
    expect(canUpdateExistingScreenStreamInPlace({
      isScreenSharing: true,
      hasScreenStream: true,
      changeSource: false,
      currentQuality: "720p30",
      requestedQuality: "720p30",
    })).toBe(true);
  });

  it("forces a restart when the requested quality changes", () => {
    expect(canUpdateExistingScreenStreamInPlace({
      isScreenSharing: true,
      hasScreenStream: true,
      changeSource: false,
      currentQuality: "720p30",
      requestedQuality: "1080p30",
    })).toBe(false);
  });

  it("forces a restart when the source changes", () => {
    expect(canUpdateExistingScreenStreamInPlace({
      isScreenSharing: true,
      hasScreenStream: true,
      changeSource: true,
      currentQuality: "720p30",
      requestedQuality: "720p30",
    })).toBe(false);
  });
});

describe("applyScreenSenderQuality", () => {
  it("skips browser screen sender retunes so capture-backed shares keep their default sender parameters", async () => {
    const sfu = {
      isNativeScreenShareActive: false,
      updateNativeScreenQuality: vi.fn().mockResolvedValue(true),
      updateSenderEncoding: vi.fn().mockResolvedValue(undefined),
    } as any;

    await applyScreenSenderQuality("720p30", sfu, "alice");

    expect(sfu.updateNativeScreenQuality).not.toHaveBeenCalled();
    expect(sfu.updateSenderEncoding).not.toHaveBeenCalled();
  });

  it("uses the native quality switch when a hardware screen share is active", async () => {
    const sfu = {
      isNativeScreenShareActive: true,
      updateNativeScreenQuality: vi.fn().mockResolvedValue(true),
      updateSenderEncoding: vi.fn().mockResolvedValue(undefined),
    } as any;

    await applyScreenSenderQuality("720p30", sfu, "alice");

    expect(sfu.updateNativeScreenQuality).toHaveBeenCalledWith("720p30");
    expect(sfu.updateSenderEncoding).not.toHaveBeenCalled();
  });

  it("no-ops when the sender context is missing", async () => {
    const sfu = {
      isNativeScreenShareActive: false,
      updateNativeScreenQuality: vi.fn().mockResolvedValue(true),
      updateSenderEncoding: vi.fn().mockResolvedValue(undefined),
    } as any;

    await applyScreenSenderQuality("720p30", null, "alice");
    await applyScreenSenderQuality("720p30", sfu, null);

    expect(sfu.updateNativeScreenQuality).not.toHaveBeenCalled();
    expect(sfu.updateSenderEncoding).not.toHaveBeenCalled();
  });
});

describe("shouldRenderRemoteScreenTile", () => {
  it("keeps a live screen tile visible when screen tracks are present", () => {
    expect(shouldRenderRemoteScreenTile({
      isStreaming: false,
      hasLiveScreenTracks: true,
      isConnected: false,
    })).toBe(true);
  });

  it("hides reconnecting stale stream placeholders when there are no live screen tracks", () => {
    expect(shouldRenderRemoteScreenTile({
      isStreaming: true,
      hasLiveScreenTracks: false,
      isConnected: false,
    })).toBe(false);
  });

  it("shows an actively connected stream placeholder before the first screen track arrives", () => {
    expect(shouldRenderRemoteScreenTile({
      isStreaming: true,
      hasLiveScreenTracks: false,
      isConnected: true,
    })).toBe(true);
  });
});
