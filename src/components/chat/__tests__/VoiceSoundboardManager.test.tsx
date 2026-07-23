// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const soundboardActivityListeners = new Set<() => void>();
  return {
    soundboardActivityListeners,
    playSoundboardPlayback: vi.fn(),
    stopAllSoundboardPlaybacksForServer: vi.fn(),
    stopSoundboardPlayback: vi.fn(),
    stopSoundboardPlaybacksByOwner: vi.fn(),
    pauseSoundboardPlayback: vi.fn(),
    resumeSoundboardPlayback: vi.fn(),
    setSoundboardPlaybackVolume: vi.fn(),
    hasActiveSoundboardPlayback: vi.fn(() => false),
    subscribeSoundboardActivity: vi.fn((listener: () => void) => {
      soundboardActivityListeners.add(listener);
      return () => soundboardActivityListeners.delete(listener);
    }),
    getSoundboardEventReceivedAt: vi.fn((sentAt: unknown) =>
      typeof sentAt === "number" ? sentAt : Date.now(),
    ),
    getSoundboardServerKey: vi.fn(
      (serverId?: string | null) => serverId || "dm-call",
    ),
  };
});

vi.mock("@/lib/voice/soundboard", () => mocks);

import { VoiceSoundboardManager } from "../VoiceSoundboardManager";
import {
  getSoundboardMediaCapabilityUrl,
  issueSoundboardMediaCapability,
} from "@/lib/voice/soundboard-media-capability";

describe("VoiceSoundboardManager", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.soundboardActivityListeners.clear();
    mocks.playSoundboardPlayback.mockReset();
    mocks.stopAllSoundboardPlaybacksForServer.mockReset();
    mocks.hasActiveSoundboardPlayback.mockReset();
    mocks.hasActiveSoundboardPlayback.mockReturnValue(false);
  });

  it("bridges only local server playback activity into VAD", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const setSoundboardSpeaking = vi.fn();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      vad: { setSoundboardSpeaking },
    };

    render(
      <VoiceSoundboardManager
        sfu={sfu as never}
        serverId="server-1"
        localUserId="local-user"
      />,
    );

    expect(mocks.hasActiveSoundboardPlayback).toHaveBeenCalledWith(
      "local-user",
      "server-1",
    );
    expect(setSoundboardSpeaking).toHaveBeenLastCalledWith(false);

    mocks.hasActiveSoundboardPlayback.mockReturnValue(true);
    act(() => {
      for (const listener of mocks.soundboardActivityListeners) listener();
    });

    expect(setSoundboardSpeaking).toHaveBeenLastCalledWith(true);

    act(() => {
      listeners.get("app-event")?.({
        type: "soundboard.play",
        server_key: "server-2",
        user_id: "local-user",
        playback_id: "other-server",
        name: "Other server",
      });
    });

    expect(mocks.playSoundboardPlayback).not.toHaveBeenCalled();
  });

  it("clears VAD soundboard activity when the manager unmounts", () => {
    const setSoundboardSpeaking = vi.fn();
    const sfu = {
      on: vi.fn(() => () => {}),
      vad: { setSoundboardSpeaking },
    };

    const view = render(
      <VoiceSoundboardManager
        sfu={sfu as never}
        serverId="server-1"
        localUserId="local-user"
      />,
    );

    view.unmount();

    expect(setSoundboardSpeaking).toHaveBeenLastCalledWith(false);
  });

  it("uses a bounded valid server sent_at for recipient playback timing", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      vad: { setSoundboardSpeaking: vi.fn() },
    };
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    render(
      <VoiceSoundboardManager
        sfu={sfu as never}
        serverId="server-1"
        localUserId="local-user"
      />,
    );

    act(() => {
      listeners.get("app-event")?.({
        type: "soundboard.play",
        server_key: "server-1",
        user_id: "remote-user",
        playback_id: "sb1:12:remote-user:sound-1",
        sound_id: "sound-1",
        name: "Clip",
        sent_at: now - 1_250,
      });
    });

    expect(mocks.playSoundboardPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ receivedAt: now - 1_250 }),
    );

    mocks.playSoundboardPlayback.mockClear();
    act(() => {
      listeners.get("app-event")?.({
        type: "soundboard.play",
        server_key: "server-1",
        user_id: "remote-user",
        playback_id: "sb1:12:remote-user:sound-2",
        sound_id: "sound-2",
        name: "Clip",
        sent_at: "not-a-timestamp",
      });
    });

    expect(mocks.playSoundboardPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ receivedAt: now }),
    );
  });

  it("only gives the sound owner an authenticated capability renewal replay", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sendAppEvent = vi.fn(() => true);
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      vad: { setSoundboardSpeaking: vi.fn() },
      voiceGW: { sendAppEvent },
    };
    const playbackId = "sb1:6:local-1:sound-1";
    const token = await issueSoundboardMediaCapability(
      {
        soundId: "sound-1",
        sourceServerId: "server-1",
        roomSlug: "dm-call-local-1-peer-1",
        playbackId,
        issuerSubject: "local-1",
        expiresAt: 2_000,
      },
      "secret",
    );
    const mediaUrl = getSoundboardMediaCapabilityUrl("sound-1", token, {
      roomSlug: "dm-call-local-1-peer-1",
      playbackId,
    });

    render(<VoiceSoundboardManager sfu={sfu as never} localUserId="local-1" />);

    act(() => {
      listeners.get("app-event")?.({
        type: "soundboard.play",
        server_key: "dm-call",
        user_id: "local-1",
        playback_id: playbackId,
        sound_id: "sound-1",
        source_server_id: "server-1",
        name: "Clip",
        media_url: mediaUrl,
        volume: 0.5,
      });
    });

    const ownerRequest = mocks.playSoundboardPlayback.mock.calls[0]?.[0] as {
      mediaCapabilityExpiresAt?: number;
      renewCapability?: (state: {
        currentTime: number;
        paused: boolean;
      }) => boolean;
    };
    expect(ownerRequest.mediaCapabilityExpiresAt).toBe(2_000);
    expect(ownerRequest.renewCapability).toEqual(expect.any(Function));
    ownerRequest.renewCapability?.({ currentTime: 12.5, paused: true });
    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "soundboard.play",
      server_key: "dm-call",
      playback_id: playbackId,
      sound_id: "sound-1",
      source_server_id: "server-1",
      name: "Clip",
      media_url: "/api/soundboard/uploads/sound-1",
      current_time: 12.5,
      paused: true,
      volume: 0.5,
    });

    mocks.playSoundboardPlayback.mockClear();
    act(() => {
      listeners.get("app-event")?.({
        type: "soundboard.play",
        server_key: "dm-call",
        user_id: "remote-1",
        playback_id: "sb1:9:remote-1:sound-1",
        sound_id: "sound-1",
        source_server_id: "server-1",
        name: "Clip",
        media_url: mediaUrl,
      });
    });

    const peerRequest = mocks.playSoundboardPlayback.mock.calls[0]?.[0] as {
      renewCapability?: () => boolean;
    };
    expect(peerRequest.renewCapability).toBeUndefined();
  });

  it("passes owner replay position and paused state to playback", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      vad: { setSoundboardSpeaking: vi.fn() },
    };
    const playbackId = "sb1:6:local-1:sound-1";
    const token = await issueSoundboardMediaCapability(
      {
        soundId: "sound-1",
        sourceServerId: "server-1",
        roomSlug: "dm-call-local-1-peer-1",
        playbackId,
        issuerSubject: "local-1",
        expiresAt: 2_000,
      },
      "secret",
    );

    render(<VoiceSoundboardManager sfu={sfu as never} localUserId="local-1" />);

    act(() => {
      listeners.get("app-event")?.({
        type: "soundboard.play",
        server_key: "dm-call",
        user_id: "local-1",
        playback_id: playbackId,
        sound_id: "sound-1",
        source_server_id: "server-1",
        name: "Clip",
        media_url: getSoundboardMediaCapabilityUrl("sound-1", token, {
          roomSlug: "dm-call-local-1-peer-1",
          playbackId,
        }),
        current_time: 12.5,
        paused: true,
      });
    });

    expect(mocks.playSoundboardPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ currentTime: 12.5, paused: true }),
    );
  });
});
