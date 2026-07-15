import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  apiPatch: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({ apiPatch: apiMocks.apiPatch }));

import {
  isSoundEnabled,
  useSoundSettingsStore,
  type SoundSettings,
} from "@/stores/useSoundSettingsStore";
import type {
  SoundboardTriggerConfig,
  SoundboardTriggerSelection,
} from "@/stores/useSoundSettingsStore";

describe("useSoundSettingsStore", () => {
  beforeEach(() => {
    apiMocks.apiPatch.mockReset();
    useSoundSettingsStore.setState({
      currentUser: null,
      userSettings: {},
      _cache: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enables stream watcher activity sounds by default", () => {
    useSoundSettingsStore.getState().setCurrentUser("user-1");

    expect(
      useSoundSettingsStore.getState().getSettings().streamWatcherActivity,
    ).toBe(true);
    expect(isSoundEnabled("streamWatcherActivity")).toBe(true);
  });

  it("defaults automatic voice soundboard triggers to disabled and empty", () => {
    useSoundSettingsStore.getState().setCurrentUser("user-1");

    expect(
      useSoundSettingsStore.getState().getSettings().voiceJoinSoundboard,
    ).toEqual({ "*": { enabled: false, sound: null } });
    expect(
      useSoundSettingsStore.getState().getSettings().voiceLeaveSoundboard,
    ).toEqual({ "*": { enabled: false, sound: null } });
  });

  it("backfills trigger defaults for partial persisted settings", () => {
    useSoundSettingsStore.setState({
      currentUser: "user-1",
      userSettings: {
        "user-1": {
          soundsEnabled: true,
          voiceJoinLeave: true,
          muteDeafen: true,
          notifications: true,
          selfConnectDisconnect: true,
          screenShare: true,
          messageReceived: true,
          calls: true,
          soundVolume: 100,
        } as unknown as SoundSettings,
      },
      _cache: {},
    });

    expect(
      useSoundSettingsStore.getState().getSettings().voiceJoinSoundboard,
    ).toEqual({ "*": { enabled: false, sound: null } });
  });

  it("updates a trigger without changing the other trigger", () => {
    const sound: SoundboardTriggerSelection = {
      source: "default",
      soundId: "chime",
      name: "Chime",
      volume: 0.75,
    };
    const trigger: SoundboardTriggerConfig = { enabled: true, sound };

    useSoundSettingsStore.getState().setCurrentUser("user-1");
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: { "*": trigger },
    });

    expect(
      useSoundSettingsStore.getState().getSettings().voiceJoinSoundboard,
    ).toEqual({ "*": trigger });
    expect(
      useSoundSettingsStore.getState().getSettings().voiceLeaveSoundboard,
    ).toEqual({ "*": { enabled: false, sound: null } });
  });

  it("hydrates and activates the backend user for default lookups", () => {
    useSoundSettingsStore.getState().setCurrentUser("old-user");
    useSoundSettingsStore.getState().hydrateFromBackend(
      {
        voiceJoinSoundboard: {
          "*": {
            enabled: true,
            sound: {
              source: "default",
              soundId: "chime",
              name: "Chime",
              volume: 1,
            },
          },
        },
        voiceLeaveSoundboard: { "*": { enabled: false, sound: null } },
      },
      "new-user",
    );

    expect(useSoundSettingsStore.getState().currentUser).toBe("new-user");
    expect(
      useSoundSettingsStore.getState().getSettings().voiceJoinSoundboard["*"]
        ?.sound?.soundId,
    ).toBe("chime");
  });

  it("queues only changed trigger fields and sends the latest snapshot after prior writes settle", async () => {
    vi.stubGlobal("window", {});
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    apiMocks.apiPatch
      .mockReturnValueOnce(firstWrite)
      .mockReturnValueOnce(Promise.resolve());
    useSoundSettingsStore.getState().setCurrentUser("user-1");

    const firstSound: SoundboardTriggerConfig = {
      enabled: true,
      sound: {
        source: "default",
        soundId: "chime",
        name: "Chime",
        volume: 1,
      },
    };
    const latestSound: SoundboardTriggerConfig = {
      enabled: false,
      sound: null,
    };

    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: { "*": firstSound },
    });
    useSoundSettingsStore.getState().updateSettings({ soundVolume: 25 });
    useSoundSettingsStore.getState().updateSettings({
      voiceJoinSoundboard: { "*": latestSound },
    });

    expect(apiMocks.apiPatch).toHaveBeenCalledTimes(1);
    expect(apiMocks.apiPatch).toHaveBeenNthCalledWith(1, "/api/users/me", {
      sound_settings: { voiceJoinSoundboard: { "*": firstSound } },
    });

    expect(apiMocks.apiPatch).toHaveBeenCalledTimes(1);
    releaseFirstWrite();
    await Promise.resolve();
    await Promise.resolve();
    expect(apiMocks.apiPatch).toHaveBeenCalledTimes(2);
    expect(apiMocks.apiPatch).toHaveBeenNthCalledWith(2, "/api/users/me", {
      sound_settings: { voiceJoinSoundboard: { "*": latestSound } },
    });
  });

  it("does not sync a trigger field when its value is unchanged", () => {
    vi.stubGlobal("window", {});
    const sound: SoundboardTriggerConfig = {
      enabled: true,
      sound: {
        source: "default",
        soundId: "chime",
        name: "Chime",
        volume: 1,
      },
    };
    useSoundSettingsStore.setState({
      currentUser: "user-1",
      userSettings: {
        "user-1": {
          ...useSoundSettingsStore.getState().getSettings("user-1"),
          voiceJoinSoundboard: { "*": sound },
        },
      },
      _cache: {},
    });

    useSoundSettingsStore
      .getState()
      .updateSettings({ voiceJoinSoundboard: { "*": { ...sound } } });

    expect(apiMocks.apiPatch).not.toHaveBeenCalled();
  });

  it("syncs the persisted soundboard receive volume", () => {
    vi.stubGlobal("window", {});
    useSoundSettingsStore.getState().setCurrentUser("user-1");

    useSoundSettingsStore.getState().updateSettings({ soundboardVolume: 42 });

    expect(apiMocks.apiPatch).toHaveBeenCalledWith("/api/users/me", {
      sound_settings: { soundboardVolume: 42 },
    });
  });

  it("backfills the stream watcher activity toggle for older stored users", () => {
    useSoundSettingsStore.setState({
      currentUser: "user-1",
      userSettings: {
        "user-1": {
          soundsEnabled: true,
          voiceJoinLeave: true,
          muteDeafen: true,
          notifications: true,
          selfConnectDisconnect: true,
          screenShare: true,
          messageReceived: true,
          calls: true,
          soundVolume: 100,
        } as any,
      },
      _cache: {},
    });

    expect(
      useSoundSettingsStore.getState().getSettings().streamWatcherActivity,
    ).toBe(true);
  });
});
