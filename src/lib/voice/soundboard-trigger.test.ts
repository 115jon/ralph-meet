import { describe, expect, it, vi } from "vitest";
import {
  ALL_SERVERS_SOUND_SCOPE,
  normalizeSoundboardTriggerMap,
  resolveSoundboardTriggerConfig,
  validatePersistedSoundboardTriggerMap,
  validatePersistedSoundboardTrigger,
  type AuthorizedSoundboardCatalogEntry,
} from "@/lib/voice/soundboard-trigger";

describe("soundboard trigger persistence validation", () => {
  const catalogEntry: AuthorizedSoundboardCatalogEntry = {
    id: "clip-1",
    serverId: "server-1",
    name: "Authorized Clip",
    emoji: "🔊",
    volume: 0.6,
  };

  it("canonicalizes an authorized server clip without persisting its media URL", async () => {
    const result = await validatePersistedSoundboardTrigger(
      {
        enabled: true,
        sound: {
          source: "server",
          soundId: "clip-1",
          serverId: "server-1",
          name: "Client supplied name",
          mediaUrl: "https://attacker.test/arbitrary.mp3",
          volume: 1,
        },
      },
      async (serverId, soundId) =>
        serverId === catalogEntry.serverId && soundId === catalogEntry.id
          ? catalogEntry
          : null,
    );

    expect(result).toEqual({
      enabled: true,
      sound: {
        source: "server",
        soundId: "clip-1",
        serverId: "server-1",
        name: "Authorized Clip",
        emoji: "🔊",
        volume: 0.6,
      },
    });
  });

  it("rejects an unauthorized server clip", async () => {
    await expect(
      validatePersistedSoundboardTriggerMap(
        {
          enabled: true,
          sound: {
            source: "server",
            soundId: "missing",
            serverId: "server-1",
            name: "Missing",
            volume: 1,
          },
        },
        async () => null,
      ),
    ).resolves.toBeNull();
  });

  it("rejects arbitrary media URLs for persisted custom selections", async () => {
    await expect(
      validatePersistedSoundboardTriggerMap(
        {
          enabled: true,
          sound: {
            source: "custom",
            soundId: "custom-1",
            name: "Custom",
            mediaUrl: "https://example.test/custom.mp3",
            volume: 1,
          },
        },
        async () => null,
      ),
    ).resolves.toBeNull();
  });

  it("drops media payloads from persisted default selections", async () => {
    await expect(
      validatePersistedSoundboardTrigger(
        {
          enabled: true,
          sound: {
            source: "default",
            soundId: "chime",
            name: "Chime",
            mediaUrl: "blob:unsafe",
            dataUrl: "data:audio/mp3;base64,large",
            volume: 1,
          },
        },
        async () => null,
      ),
    ).resolves.toEqual({
      enabled: true,
      sound: {
        source: "default",
        soundId: "chime",
        name: "Chime",
        volume: 1,
      },
    });
  });

  it("migrates a legacy global trigger config into the All Servers scope", () => {
    expect(
      normalizeSoundboardTriggerMap({
        enabled: true,
        sound: {
          source: "default",
          soundId: "chime",
          name: "Chime",
          volume: 1,
        },
      }),
    ).toEqual({
      [ALL_SERVERS_SOUND_SCOPE]: {
        enabled: true,
        sound: {
          source: "default",
          soundId: "chime",
          name: "Chime",
          volume: 1,
        },
      },
    });
  });

  it("resolves a server override before the All Servers fallback", () => {
    const fallback = { enabled: true, sound: null };
    const override = { enabled: false, sound: null };
    const map = {
      [ALL_SERVERS_SOUND_SCOPE]: fallback,
      "server-1": override,
    };

    expect(resolveSoundboardTriggerConfig(map, "server-1")).toEqual(override);
    expect(resolveSoundboardTriggerConfig(map, "server-2")).toEqual(fallback);
    expect(resolveSoundboardTriggerConfig(map)).toEqual(fallback);
  });

  it("validates every server selection in a trigger map", async () => {
    const resolveServerSound = vi.fn(
      async (serverId: string, soundId: string) =>
        serverId === "server-1" && soundId === "clip-1" ? catalogEntry : null,
    );

    await expect(
      validatePersistedSoundboardTriggerMap(
        {
          [ALL_SERVERS_SOUND_SCOPE]: {
            enabled: true,
            sound: {
              source: "server",
              serverId: "server-1",
              soundId: "clip-1",
              name: "Clip",
              volume: 1,
            },
          },
          "server-2": {
            enabled: true,
            sound: {
              source: "server",
              serverId: "server-1",
              soundId: "clip-1",
              name: "Clip",
              volume: 1,
            },
          },
        },
        resolveServerSound,
      ),
    ).resolves.toEqual({
      [ALL_SERVERS_SOUND_SCOPE]: {
        enabled: true,
        sound: {
          source: "server",
          serverId: "server-1",
          soundId: "clip-1",
          name: "Authorized Clip",
          emoji: "🔊",
          volume: 0.6,
        },
      },
      "server-2": {
        enabled: true,
        sound: {
          source: "server",
          serverId: "server-1",
          soundId: "clip-1",
          name: "Authorized Clip",
          emoji: "🔊",
          volume: 0.6,
        },
      },
    });
    expect(resolveServerSound).toHaveBeenCalledTimes(2);
  });

  it("drops unavailable server overrides while preserving valid scopes", async () => {
    await expect(
      validatePersistedSoundboardTriggerMap(
        {
          [ALL_SERVERS_SOUND_SCOPE]: {
            enabled: true,
            sound: {
              source: "default",
              soundId: "chime",
              name: "Chime",
              volume: 1,
            },
          },
          "old-server": {
            enabled: true,
            sound: {
              source: "server",
              serverId: "old-server",
              soundId: "old-clip",
              name: "Old Clip",
              volume: 1,
            },
          },
        },
        async () => null,
      ),
    ).resolves.toEqual({
      [ALL_SERVERS_SOUND_SCOPE]: {
        enabled: true,
        sound: {
          source: "default",
          soundId: "chime",
          name: "Chime",
          volume: 1,
        },
      },
    });
  });
});
