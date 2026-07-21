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
  scheduleAutomaticSoundboardCleanup,
} from "@/lib/voice/auto-soundboard";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";

describe("automatic soundboard triggers", () => {
  const sendAppEvent = vi.fn(() => true);

  beforeEach(() => {
    mocks.playSoundboardPlayback.mockReset();
    mocks.apiGet.mockReset();
    sendAppEvent.mockReset();
    sendAppEvent.mockReturnValue(true);
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
    await playAutomaticSoundboardTrigger("join", "session-1", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    await playAutomaticSoundboardTrigger("join", "session-1", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });

    expect(sendAppEvent).toHaveBeenCalledTimes(1);
    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "soundboard.play",
        server_key: "server-1",
        user_id: "user-1",
        playback_id: expect.stringMatching(/^sb1:/),
        sound_id: "chime",
        volume: 0.4,
        automatic_event: "join",
      }),
    );
    expect(mocks.playSoundboardPlayback).not.toHaveBeenCalled();
  });

  it("does not play a leave sound until a session has joined", async () => {
    await playAutomaticSoundboardTrigger("leave", "session-2", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    expect(sendAppEvent).not.toHaveBeenCalled();
  });

  it("waits for a reconnecting voice gateway before sending the join trigger", async () => {
    let resolveReady!: () => void;
    let ready = false;
    const waitUntilReady = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReady = resolve;
        }),
    );
    const trigger = playAutomaticSoundboardTrigger(
      "join",
      "reconnect-session",
      undefined,
      {
        serverKey: "server-1",
        userId: "user-1",
        sendAppEvent,
        isReady: () => ready,
        waitUntilReady,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendAppEvent).not.toHaveBeenCalled();

    ready = true;
    resolveReady();
    await expect(trigger).resolves.toBe(true);
    expect(waitUntilReady).toHaveBeenCalledTimes(1);
    expect(sendAppEvent).toHaveBeenCalledTimes(1);
  });

  it("does not wait for gateway readiness before sending a leave trigger", async () => {
    await playAutomaticSoundboardTrigger("join", "fast-leave", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    const result = await playAutomaticSoundboardTrigger(
      "leave",
      "fast-leave",
      undefined,
      {
        serverKey: "server-1",
        userId: "user-1",
        sendAppEvent,
        isReady: () => false,
        waitUntilReady: () => new Promise<void>(() => {}),
      },
    );

    expect(result).toBe(false);
  });

  it("plays leave once after join and can be reused after reset", async () => {
    await playAutomaticSoundboardTrigger("join", "session-3", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    await playAutomaticSoundboardTrigger("leave", "session-3", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    await playAutomaticSoundboardTrigger("leave", "session-3", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    expect(sendAppEvent).toHaveBeenCalledTimes(2);

    resetAutomaticSoundboardSession("session-3");
    await playAutomaticSoundboardTrigger("join", "session-3", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    expect(sendAppEvent).toHaveBeenCalledTimes(3);
  });

  it("resolves server selections from the authorized catalog before playing", async () => {
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: {
        "*": {
          enabled: true,
          sound: {
            source: "server",
            serverId: "active-server",
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
        file_url: "/api/soundboard/uploads/clip-1",
        volume: 0.75,
      },
    ]);

    await playAutomaticSoundboardTrigger("join", "session-4", undefined, {
      serverKey: "active-server",
      userId: "user-1",
      sendAppEvent,
    });

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "soundboard.play",
        server_key: "active-server",
        user_id: "user-1",
        name: "Catalog clip",
        media_url: "/api/soundboard/uploads/clip-1",
        volume: 0.375,
      }),
    );
    expect(mocks.playSoundboardPlayback).not.toHaveBeenCalled();
  });

  it("includes the source server when a DM call plays a server sound", async () => {
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: {
        "*": {
          enabled: true,
          sound: {
            source: "server",
            serverId: "source-server",
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
        file_url: "/api/soundboard/uploads/clip-1",
      },
    ]);

    await playAutomaticSoundboardTrigger("join", "dm-session", undefined, {
      serverKey: "dm-call",
      userId: "user-1",
      sendAppEvent,
    });

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        server_key: "dm-call",
        source_server_id: "source-server",
        media_url: "/api/soundboard/uploads/clip-1",
      }),
    );
  });

  it("does not send custom automatic media to a DM call", async () => {
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: {
        "*": {
          enabled: true,
          sound: {
            source: "custom",
            soundId: "custom-clip",
            name: "Custom clip",
            mediaUrl: "/uploads/custom-clip.mp3",
            volume: 1,
          },
        },
      },
    });

    await expect(
      playAutomaticSoundboardTrigger("join", "dm-custom", undefined, {
        serverKey: "dm-call",
        userId: "user-1",
        sendAppEvent,
      }),
    ).resolves.toBe(false);
    expect(sendAppEvent).not.toHaveBeenCalled();
  });

  it("does not send server media across active server scopes", async () => {
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: {
        "*": {
          enabled: true,
          sound: {
            source: "server",
            serverId: "source-server",
            soundId: "clip-1",
            name: "Saved name",
            volume: 1,
          },
        },
      },
    });

    await expect(
      playAutomaticSoundboardTrigger("join", "cross-server", undefined, {
        serverKey: "active-server",
        userId: "user-1",
        sendAppEvent,
      }),
    ).resolves.toBe(false);
    expect(sendAppEvent).not.toHaveBeenCalled();
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

    await playAutomaticSoundboardTrigger("join", "race-session", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    const staleLeave = playAutomaticSoundboardTrigger(
      "leave",
      "race-session",
      undefined,
      {
        serverKey: "server-1",
        userId: "user-1",
        sendAppEvent,
      },
    );
    resetAutomaticSoundboardSession("race-session");
    await playAutomaticSoundboardTrigger("join", "race-session", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    resolveCatalog([
      {
        id: "clip-1",
        name: "Catalog clip",
        file_url: "/api/soundboard/uploads/clip-1",
        volume: 1,
      },
    ]);
    await staleLeave;

    expect(sendAppEvent).toHaveBeenCalledTimes(2);
    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sound_id: "chime" }),
    );
    expect(sendAppEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ media_url: "/api/attachments/clip-1" }),
    );
  });

  it("does not let stale scheduled cleanup reset a replacement session", async () => {
    await playAutomaticSoundboardTrigger(
      "join",
      "scheduled-session",
      undefined,
      {
        serverKey: "server-1",
        userId: "user-1",
        sendAppEvent,
      },
    );

    scheduleAutomaticSoundboardCleanup("scheduled-session", undefined, {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
      isReady: () => false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    resetAutomaticSoundboardSession("scheduled-session");
    await playAutomaticSoundboardTrigger(
      "join",
      "scheduled-session",
      undefined,
      {
        serverKey: "server-1",
        userId: "user-1",
        sendAppEvent,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    await playAutomaticSoundboardTrigger(
      "leave",
      "scheduled-session",
      undefined,
      {
        serverKey: "server-1",
        userId: "user-1",
        sendAppEvent,
      },
    );

    expect(sendAppEvent).toHaveBeenCalledTimes(3);
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

    await playAutomaticSoundboardTrigger("join", "scoped-server", "server-1", {
      serverKey: "server-1",
      userId: "user-1",
      sendAppEvent,
    });
    expect(sendAppEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ sound_id: "ping" }),
    );

    resetAutomaticSoundboardSession("scoped-server");
    await playAutomaticSoundboardTrigger(
      "join",
      "scoped-fallback",
      "server-2",
      {
        serverKey: "server-2",
        userId: "user-1",
        sendAppEvent,
      },
    );
    expect(sendAppEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ sound_id: "chime" }),
    );
  });
});
