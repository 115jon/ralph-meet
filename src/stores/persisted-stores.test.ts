// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

// zustand's `persist` only exposes `persist.getOptions()` and `rehydrate()`
// when a storage exists, and `window.localStorage` is jsdom's here.
import { useChatStore } from "@/stores/chat-store";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { useListenTogetherAudioSettingsStore } from "@/stores/useListenTogetherAudioSettingsStore";
import { useMediaPlaybackSettingsStore } from "@/stores/useMediaPlaybackSettingsStore";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

// What a store reads back from localStorage can be corrupt, hand-edited or
// written by another release. `merge` runs on every hydration and `migrate` on
// a version change; both must hand the store valid fields or its defaults.

const storage = window.localStorage;

const NOT_STATE = [undefined, null, 7, "text", [], true];

// The hydrated state differs per store and the tests only probe parts of it.
type Hydrated = any;

function options(store: { persist: { getOptions: () => object } }) {
  return store.persist.getOptions() as {
    merge: (persisted: unknown, current: never) => Hydrated;
    migrate: (persisted: unknown, version: number) => Hydrated;
  };
}

describe("useDesktopSettingsStore", () => {
  const { merge } = options(useDesktopSettingsStore);
  const current = useDesktopSettingsStore.getState();

  it("keeps stored booleans and defaults everything else", () => {
    expect(
      merge(
        {
          openOnStartup: true,
          closeToTray: "yes",
          hardwareAcceleration: 0,
          desktopNotifications: false,
          updateSettings: "not a function",
          somethingElse: 1,
        },
        current as never,
      ),
    ).toMatchObject({
      openOnStartup: true,
      startMinimized: false,
      closeToTray: true,
      hardwareAcceleration: true,
      desktopNotifications: false,
      updateSettings: current.updateSettings,
    });
    expect(merge({ somethingElse: 1 }, current as never)).not.toHaveProperty(
      "somethingElse",
    );
  });

  it.each(NOT_STATE)("falls back to the defaults for %j", (stored) => {
    expect(merge(stored, current as never)).toMatchObject({
      openOnStartup: false,
      closeToTray: true,
    });
  });
});

describe("useMediaPlaybackSettingsStore", () => {
  const { merge } = options(useMediaPlaybackSettingsStore);
  const current = useMediaPlaybackSettingsStore.getState();

  it("clamps a stored volume and drops retyped fields", () => {
    expect(
      merge({ videoVolume: 7, videoMuted: "no" }, current as never),
    ).toMatchObject({ videoVolume: 1, videoMuted: false });
    expect(
      merge({ videoVolume: "0.2", videoMuted: true }, current as never),
    ).toMatchObject({ videoVolume: 1, videoMuted: true });
    expect(
      merge({ videoVolume: 0.4, videoMuted: true }, current as never),
    ).toMatchObject({ videoVolume: 0.4, videoMuted: true });
  });

  it.each(NOT_STATE)("falls back to the defaults for %j", (stored) => {
    expect(merge(stored, current as never)).toMatchObject({
      videoVolume: 1,
      videoMuted: false,
    });
  });
});

describe("useListenTogetherAudioSettingsStore", () => {
  const { merge } = options(useListenTogetherAudioSettingsStore);
  const current = useListenTogetherAudioSettingsStore.getState();

  it("rejects unknown presets, including names from Object.prototype", () => {
    for (const preset of [
      "cinema",
      "toString",
      "__proto__",
      "constructor",
      3,
    ]) {
      expect(merge({ enabled: false, preset }, current as never)).toMatchObject(
        { enabled: false, preset: "balanced" },
      );
    }
    expect(
      merge({ enabled: "no", preset: "peak-protection" }, current as never),
    ).toMatchObject({ enabled: true, preset: "peak-protection" });
  });

  it.each(NOT_STATE)("falls back to the defaults for %j", (stored) => {
    expect(merge(stored, current as never)).toMatchObject({
      enabled: true,
      preset: "balanced",
    });
  });
});

describe("useMediaSafetySettingsStore", () => {
  const { merge } = options(useMediaSafetySettingsStore);
  const current = useMediaSafetySettingsStore.getState();

  it("keeps valid user entries, defaults bad filters and drops bad entries", () => {
    const merged = merge(
      {
        currentUser: "user-1",
        _cache: { stale: { contentFilter: "off" } },
        userSettings: {
          "user-1": { contentFilter: "low" },
          "user-2": { contentFilter: "everything" },
          "user-3": {},
          "user-4": "high",
          "user-5": null,
        },
      },
      current as never,
    );

    expect(merged.currentUser).toBe("user-1");
    expect(merged._cache).toEqual({});
    expect(merged.userSettings).toEqual({
      "user-1": { contentFilter: "low" },
      "user-2": { contentFilter: "high" },
      "user-3": { contentFilter: "high" },
    });
  });

  it.each([...NOT_STATE, { userSettings: "x", currentUser: 4 }])(
    "falls back to the defaults for %j",
    (stored) => {
      expect(merge(stored, current as never)).toMatchObject({
        currentUser: null,
        userSettings: {},
      });
    },
  );
});

describe("useSoundSettingsStore", () => {
  const { merge } = options(useSoundSettingsStore);
  const current = useSoundSettingsStore.getState();

  it("fills each user's entry field by field", () => {
    const merged = merge(
      {
        currentUser: "user-1",
        userSettings: {
          "user-1": {
            soundsEnabled: false,
            calls: "yes",
            soundVolume: 40,
            soundboardVolume: "loud",
            voiceJoinSoundboard: { enabled: true, sound: null },
            voiceLeaveSoundboard: "garbage",
            retired_field: true,
          },
          "user-2": 5,
        },
      },
      current as never,
    );

    expect(merged.currentUser).toBe("user-1");
    expect(Object.keys(merged.userSettings as object)).toEqual(["user-1"]);
    expect((merged.userSettings as Record<string, unknown>)["user-1"]).toEqual({
      soundsEnabled: false,
      voiceJoinLeave: true,
      muteDeafen: true,
      notifications: true,
      selfConnectDisconnect: true,
      screenShare: true,
      streamWatcherActivity: true,
      messageReceived: true,
      calls: true,
      soundVolume: 40,
      soundboardVolume: 100,
      voiceJoinSoundboard: { "*": { enabled: true, sound: null } },
      voiceLeaveSoundboard: { "*": { enabled: false, sound: null } },
    });
  });

  it("reads an entry stored before newer settings existed", () => {
    const merged = merge(
      { currentUser: "user-1", userSettings: { "user-1": { calls: false } } },
      current as never,
    );

    expect(
      useSoundSettingsStore.getState().getSettings.call(null, "nobody"),
    ).toBeDefined();
    expect(
      (merged.userSettings as Record<string, Record<string, unknown>>)[
        "user-1"
      ],
    ).toMatchObject({
      calls: false,
      streamWatcherActivity: true,
      soundVolume: 100,
    });
  });

  it.each([...NOT_STATE, { userSettings: [], currentUser: {} }])(
    "falls back to the defaults for %j",
    (stored) => {
      expect(merge(stored, current as never)).toMatchObject({
        currentUser: null,
        userSettings: {},
      });
    },
  );
});

describe("useChatStore", () => {
  const { merge, migrate } = options(useChatStore);
  const current = useChatStore.getState();

  it("migrates away the ids older versions persisted", () => {
    expect(
      migrate(
        {
          activeServerId: "server-1",
          activeChannelId: "channel-1",
          scrollPositions: { "channel-1": "message-9" },
          jumpAnchors: { "channel-2": "message-3" },
          messages: ["leaked"],
        },
        1,
      ),
    ).toEqual({
      scrollPositions: { "channel-1": "message-9" },
      jumpAnchors: { "channel-2": "message-3" },
    });
  });

  it("drops positions that are not message ids", () => {
    expect(
      merge(
        {
          scrollPositions: { a: "m1", b: 5, c: null },
          jumpAnchors: ["not", "a", "map"],
        },
        current as never,
      ),
    ).toMatchObject({ scrollPositions: { a: "m1" }, jumpAnchors: {} });
  });

  it.each(NOT_STATE)("starts empty for %j", (stored) => {
    expect(migrate(stored, 1)).toEqual({});
    expect(merge(stored, current as never)).toMatchObject({
      scrollPositions: {},
      jumpAnchors: {},
      dispatch: current.dispatch,
    });
  });
});

describe("useVoiceSettingsStore", () => {
  const { merge, migrate } = options(useVoiceSettingsStore);
  const current = useVoiceSettingsStore.getState();

  type Stored = {
    currentUser: string | null;
    userSettings: Record<string, Record<string, unknown>>;
  };

  it("fills a corrupt entry field by field and keeps what is valid", () => {
    const merged = merge(
      {
        currentUser: "user-1",
        _cache: { stale: {} },
        userSettings: {
          "user-1": {
            inputDeviceId: 5,
            outputDeviceId: "speakers",
            sensitivity: -30,
            isMuted: "yes",
            cameraQuality: "4k120",
            cameraBackground: { type: "blur", strength: "heavy" },
            customCameraBackgrounds: [
              { id: "bg", name: "Beach", createdAt: 5, sizeBytes: "big" },
              { id: "bad" },
              null,
            ],
            noiseReductionProvider: "magic",
            inputProfile: "studio",
            spatialPlacementMode: "orbit",
            spatialManualPositions: { a: { x: 1, y: 2 }, b: { x: "1" } },
            peerSettings: { p1: { volume: 40, muted: true }, p2: "loud" },
            lastChannelId: 12,
            lastServerId: "server-1",
            alwaysPreviewVideo: "no",
            unknownField: 1,
          },
          "user-2": "nope",
        },
      },
      current as never,
    ) as Stored;

    expect(merged.currentUser).toBe("user-1");
    expect(merged).not.toHaveProperty("unknownField");
    expect(Object.keys(merged.userSettings)).toEqual(["user-1"]);
    const entry = merged.userSettings["user-1"];
    expect(entry).toMatchObject({
      inputDeviceId: "default",
      outputDeviceId: "speakers",
      sensitivity: -30,
      isMuted: false,
      cameraQuality: "720p30",
      cameraBackground: { type: "none" },
      customCameraBackgrounds: [{ id: "bg", name: "Beach", createdAt: 5 }],
      noiseReductionProvider: "rnnoise",
      inputProfile: "studio",
      spatialPlacementMode: "arc",
      spatialManualPositions: { a: { x: 1, y: 2 } },
      lastChannelId: null,
      lastServerId: "server-1",
    });
    expect(entry).not.toHaveProperty("unknownField");
    expect(entry).not.toHaveProperty("alwaysPreviewVideo");
    // Peer entries are completed like `getSettings` does: stream volume
    // follows the voice volume for entries stored without one.
    expect(entry.peerSettings).toEqual({
      p1: {
        volume: 40,
        streamVolume: 40,
        muted: true,
        alwaysHear: false,
        attenuationEnabled: false,
        attenuationStrength: 50,
        soundboardMuted: false,
      },
    });
    expect(merged).not.toHaveProperty("_cache", { stale: {} });
  });

  it.each([...NOT_STATE, { userSettings: "x", currentUser: 4 }])(
    "falls back to the defaults for %j",
    (stored) => {
      expect(merge(stored, current as never)).toMatchObject({
        currentUser: null,
        userSettings: {},
        setCurrentUser: current.setCurrentUser,
      });
    },
  );

  describe("migrating older versions", () => {
    const legacyEntry = {
      inputDeviceId: "mic-1",
      outputDeviceId: "default",
      videoDeviceId: "default",
      streamHighFidelity: true,
      noiseSuppression: true,
      echoCancellation: true,
    };

    it("version 0: high fidelity turns browser processing off, then profiles become custom", () => {
      const migrated = migrate(
        { currentUser: "u", userSettings: { u: { ...legacyEntry } } },
        0,
      ) as Stored;

      expect(migrated.userSettings.u).toMatchObject({
        inputDeviceId: "mic-1",
        streamHighFidelity: true,
        noiseSuppression: false,
        echoCancellation: false,
        // Filled by the version 3 step.
        noiseReductionEnabled: false,
        noiseReductionProvider: "rnnoise",
        inputProfile: "custom",
      });
    });

    it("version 1: room-scoped entries collapse into the guest entry", () => {
      const migrated = migrate(
        {
          currentUser: "room-abc",
          userSettings: {
            "room-abc": { ...legacyEntry, inputDeviceId: "room-mic" },
            "room-def": { ...legacyEntry },
            "user-1": { ...legacyEntry },
          },
        },
        1,
      ) as Stored;

      expect(Object.keys(migrated.userSettings).sort()).toEqual([
        "room-guest",
        "user-1",
      ]);
      expect(migrated.userSettings["room-guest"].inputDeviceId).toBe(
        "room-mic",
      );
      expect(migrated.currentUser).toBe("room-guest");
    });

    it("version 2: backfills the noise reduction settings", () => {
      const migrated = migrate(
        {
          currentUser: "u",
          userSettings: { u: { inputDeviceId: "mic-1" } },
        },
        2,
      ) as Stored;

      expect(migrated.userSettings.u).toMatchObject({
        inputDeviceId: "mic-1",
        noiseReductionEnabled: false,
        noiseReductionProvider: "rnnoise",
        inputProfile: "custom",
      });
    });

    it("version 4: existing profiles are marked custom", () => {
      const migrated = migrate(
        {
          currentUser: "u",
          userSettings: { u: { ...legacyEntry, inputProfile: "studio" } },
        },
        4,
      ) as Stored;

      expect(migrated.userSettings.u.inputProfile).toBe("custom");
    });

    it("the current version keeps the profile it was saved with", () => {
      const migrated = migrate(
        {
          currentUser: "u",
          userSettings: { u: { ...legacyEntry, inputProfile: "studio" } },
        },
        5,
      ) as Stored;

      expect(migrated.userSettings.u.inputProfile).toBe("studio");
    });

    it("sanitizes corrupt data before the steps run, and survives a non-object", () => {
      const migrated = migrate(
        {
          currentUser: 3,
          userSettings: { u: { ...legacyEntry, streamHighFidelity: "yes" } },
        },
        0,
      ) as Stored;

      expect(migrated.currentUser).toBeNull();
      expect(migrated.userSettings.u).toMatchObject({
        streamHighFidelity: false,
        noiseSuppression: true,
      });
      for (const bad of NOT_STATE) {
        expect(migrate(bad, 0)).toEqual({
          currentUser: null,
          userSettings: {},
        });
      }
    });
  });
});

describe("rehydrating from localStorage", () => {
  it("migrates a version 0 voice payload end to end", async () => {
    storage.setItem(
      "voice-settings-storage",
      JSON.stringify({
        version: 0,
        state: {
          currentUser: "room-abc",
          userSettings: {
            "room-abc": {
              inputDeviceId: "room-mic",
              outputDeviceId: "default",
              videoDeviceId: "default",
              streamHighFidelity: true,
              noiseSuppression: true,
              echoCancellation: true,
              sensitivity: "very",
            },
          },
          _cache: { "room-abc": { __raw: true } },
        },
      }),
    );

    await useVoiceSettingsStore.persist.rehydrate();

    const state = useVoiceSettingsStore.getState();
    expect(state.currentUser).toBe("room-guest");
    expect(Object.keys(state.userSettings)).toEqual(["room-guest"]);
    expect(state.getSettings("room-guest")).toMatchObject({
      inputDeviceId: "room-mic",
      noiseSuppression: false,
      echoCancellation: false,
      sensitivity: -50,
      noiseReductionEnabled: false,
      inputProfile: "custom",
    });
    expect(state.setCurrentUser).toBeTypeOf("function");
  });

  it("rewrites the migrated state without derived fields", async () => {
    storage.setItem(
      "voice-settings-storage",
      JSON.stringify({ version: 2, state: { userSettings: {} } }),
    );
    await useVoiceSettingsStore.persist.rehydrate();

    const written = JSON.parse(
      storage.getItem("voice-settings-storage") ?? "{}",
    ) as { version: number; state: Record<string, unknown> };
    expect(written.version).toBe(5);
    expect(Object.keys(written.state).sort()).toEqual([
      "currentUser",
      "userSettings",
    ]);
  });

  it("keeps the defaults when the stored text is not JSON", async () => {
    for (const [store, name] of [
      [useVoiceSettingsStore, "voice-settings-storage"],
      [useSoundSettingsStore, "sound-settings-storage"],
      [useMediaSafetySettingsStore, "media-safety-settings-storage"],
      [useChatStore, "rm-chat-store"],
    ] as const) {
      storage.setItem(name, "{not json");
      await store.persist.rehydrate();
    }

    expect(useSoundSettingsStore.getState().userSettings).toEqual({});
    expect(useChatStore.getState().scrollPositions).toEqual({});
  });

  it("keeps the defaults when the stored state has the wrong shape", async () => {
    storage.setItem(
      "sound-settings-storage",
      JSON.stringify({ version: 1, state: "oops" }),
    );
    storage.setItem(
      "desktop-settings-storage",
      JSON.stringify({ version: 1, state: { closeToTray: "yes" } }),
    );

    await useSoundSettingsStore.persist.rehydrate();
    await useDesktopSettingsStore.persist.rehydrate();

    expect(useSoundSettingsStore.getState().userSettings).toEqual({});
    expect(useDesktopSettingsStore.getState().closeToTray).toBe(true);
  });
});
