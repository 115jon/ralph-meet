import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playSoundboardPlayback: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock("@/lib/voice/soundboard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/voice/soundboard")>();
  return {
    ...actual,
    getSoundboardServerKey: (serverId?: string | null) => serverId || "dm-call",
    playSoundboardPlayback: mocks.playSoundboardPlayback,
  };
});
vi.mock("@/lib/api-client", () => ({ apiGet: mocks.apiGet }));

import {
  playAutomaticSoundboardTrigger,
  resetAutomaticSoundboardSession,
} from "@/lib/voice/auto-soundboard";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";

describe("automatic soundboard triggers", () => {
  beforeEach(() => {
    mocks.playSoundboardPlayback.mockReset();
    mocks.apiGet.mockReset();
    useSoundSettingsStore.setState({
      currentUser: "user-1",
      userSettings: {
        "user-1": {
          ...useSoundSettingsStore.getState().getSettings("user-1"),
          soundsEnabled: true,
          soundVolume: 50,
          voiceJoinSoundboard: {
            "*": {
              enabled: true,
              sound: {
                source: "default",
                soundId: "chime",
                name: "Chime",
                volume: 0.8,
              },
            },
          },
          voiceLeaveSoundboard: {
            "*": {
              enabled: true,
              sound: {
                source: "default",
                soundId: "pop",
                name: "Pop",
                volume: 0.4,
              },
            },
          },
        },
      },
      _cache: {},
    });
  });

  it("plays a configured join sound once with general effects volume applied", async () => {
    await playAutomaticSoundboardTrigger("join", "session-1");
    await playAutomaticSoundboardTrigger("join", "session-1");

    expect(mocks.playSoundboardPlayback).toHaveBeenCalledTimes(1);
    expect(mocks.playSoundboardPlayback).toHaveBeenCalledWith(
      expect.objectContaining({
        playbackId: expect.stringContaining("session-1:join"),
        soundId: "chime",
        volume: 0.4,
        isLocal: true,
      }),
    );
  });

  it("does not play a leave sound until a session has joined", async () => {
    await playAutomaticSoundboardTrigger("leave", "session-2");
    expect(mocks.playSoundboardPlayback).not.toHaveBeenCalled();
  });

  it("plays leave once after join and can be reused after reset", async () => {
    await playAutomaticSoundboardTrigger("join", "session-3");
    await playAutomaticSoundboardTrigger("leave", "session-3");
    await playAutomaticSoundboardTrigger("leave", "session-3");
    expect(mocks.playSoundboardPlayback).toHaveBeenCalledTimes(2);

    resetAutomaticSoundboardSession("session-3");
    await playAutomaticSoundboardTrigger("join", "session-3");
    expect(mocks.playSoundboardPlayback).toHaveBeenCalledTimes(3);
  });

  it("resolves server selections from the authorized catalog before playing", async () => {
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: {
        "*": {
          enabled: true,
          sound: {
            source: "server",
            serverId: "server-1",
            soundId: "clip-1",
            name: "Saved name",
            volume: 1,
          },
        },
      },
    });
    mocks.apiGet.mockResolvedValue([
      {
        id: "clip-1",
        name: "Catalog clip",
        file_url: "/api/attachments/clip-1",
        volume: 0.75,
      },
    ]);

    await playAutomaticSoundboardTrigger("join", "session-4");

    expect(mocks.playSoundboardPlayback).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Catalog clip",
        mediaUrl: "/api/attachments/clip-1",
        volume: 0.375,
        serverKey: "server-1",
      }),
    );
  });

  it("does not play a stale leave sound after the session is replaced", async () => {
    useSoundSettingsStore.getState().updateSettings({
      voiceLeaveSoundboard: {
        "*": {
          enabled: true,
          sound: {
            source: "server",
            serverId: "server-1",
            soundId: "clip-1",
            name: "Saved name",
            volume: 1,
          },
        },
      },
    });
    let resolveCatalog!: (value: unknown) => void;
    mocks.apiGet.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );

    await playAutomaticSoundboardTrigger("join", "race-session");
    const staleLeave = playAutomaticSoundboardTrigger("leave", "race-session");
    resetAutomaticSoundboardSession("race-session");
    await playAutomaticSoundboardTrigger("join", "race-session");
    resolveCatalog([
      {
        id: "clip-1",
        name: "Catalog clip",
        file_url: "/api/attachments/clip-1",
        volume: 1,
      },
    ]);
    await staleLeave;

    expect(mocks.playSoundboardPlayback).toHaveBeenCalledTimes(2);
    expect(mocks.playSoundboardPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ soundId: "chime" }),
    );
    expect(mocks.playSoundboardPlayback).not.toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: "/api/attachments/clip-1" }),
    );
  });

  it("uses the current server override and falls back to All Servers", async () => {
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: {
        "*": {
          enabled: true,
          sound: {
            source: "default",
            soundId: "chime",
            name: "Global Chime",
            volume: 1,
          },
        },
        "server-1": {
          enabled: true,
          sound: {
            source: "default",
            soundId: "ping",
            name: "Server Ping",
            volume: 1,
          },
        },
      },
    });

    await playAutomaticSoundboardTrigger("join", "scoped-server", "server-1");
    expect(mocks.playSoundboardPlayback).toHaveBeenLastCalledWith(
      expect.objectContaining({ soundId: "ping" }),
    );

    resetAutomaticSoundboardSession("scoped-server");
    await playAutomaticSoundboardTrigger("join", "scoped-fallback", "server-2");
    expect(mocks.playSoundboardPlayback).toHaveBeenLastCalledWith(
      expect.objectContaining({ soundId: "chime" }),
    );
  });
});
