export type SoundboardTriggerSource = "default" | "server" | "custom";
export const ALL_SERVERS_SOUND_SCOPE = "*";

export interface SoundboardTriggerSelection {
  source: SoundboardTriggerSource;
  soundId: string;
  name: string;
  dataUrl?: string;
  mediaUrl?: string;
  serverId?: string;
  emoji?: string;
  volume: number;
}

export interface SoundboardTriggerConfig {
  enabled: boolean;
  sound: SoundboardTriggerSelection | null;
}

export type SoundboardTriggerMap = Record<string, SoundboardTriggerConfig>;

export interface AuthorizedSoundboardCatalogEntry {
  id: string;
  serverId: string;
  name: string;
  emoji?: string;
  volume: number;
}

export const EMPTY_SOUNDBOARD_TRIGGER: SoundboardTriggerConfig = {
  enabled: false,
  sound: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSource(value: unknown): value is SoundboardTriggerSource {
  return value === "default" || value === "server" || value === "custom";
}

export function parseSoundboardTriggerConfig(
  value: unknown,
): SoundboardTriggerConfig | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  if (value.sound === null) {
    return { enabled: value.enabled, sound: null };
  }
  if (!isRecord(value.sound)) return null;

  const sound = value.sound;
  if (
    !isSource(sound.source) ||
    typeof sound.soundId !== "string" ||
    sound.soundId.length === 0 ||
    sound.soundId.length > 200 ||
    typeof sound.name !== "string" ||
    sound.name.length === 0 ||
    sound.name.length > 200 ||
    typeof sound.volume !== "number" ||
    !Number.isFinite(sound.volume) ||
    sound.volume < 0 ||
    sound.volume > 1
  ) {
    return null;
  }

  if (sound.source === "server" && typeof sound.serverId !== "string") {
    return null;
  }

  const selection: SoundboardTriggerSelection = {
    source: sound.source,
    soundId: sound.soundId,
    name: sound.name,
    volume: sound.volume,
  };

  if (typeof sound.emoji === "string" && sound.emoji.length <= 100) {
    selection.emoji = sound.emoji;
  }
  if (typeof sound.serverId === "string" && sound.serverId.length <= 200) {
    selection.serverId = sound.serverId;
  }
  if (sound.source !== "server" && typeof sound.mediaUrl === "string") {
    selection.mediaUrl = sound.mediaUrl;
  }

  return { enabled: value.enabled, sound: selection };
}

export function normalizeSoundboardTriggerConfig(
  value: unknown,
): SoundboardTriggerConfig {
  const parsed = parseSoundboardTriggerConfig(value);
  return parsed
    ? {
        enabled: parsed.enabled,
        sound: parsed.sound ? { ...parsed.sound } : null,
      }
    : { ...EMPTY_SOUNDBOARD_TRIGGER };
}

export function normalizeSoundboardTriggerMap(
  value: unknown,
): SoundboardTriggerMap {
  const legacy = parseSoundboardTriggerConfig(value);
  if (legacy) {
    return { [ALL_SERVERS_SOUND_SCOPE]: legacy };
  }

  if (!isRecord(value)) {
    return { [ALL_SERVERS_SOUND_SCOPE]: { ...EMPTY_SOUNDBOARD_TRIGGER } };
  }

  const map: SoundboardTriggerMap = {};
  for (const [scope, config] of Object.entries(value)) {
    const parsed = parseSoundboardTriggerConfig(config);
    if (parsed) map[scope] = parsed;
  }
  return map;
}

export function resolveSoundboardTriggerConfig(
  value: unknown,
  serverId?: string | null,
): SoundboardTriggerConfig {
  const map = normalizeSoundboardTriggerMap(value);
  const resolved = serverId ? map[serverId] : undefined;
  return resolved ?? map[ALL_SERVERS_SOUND_SCOPE] ?? EMPTY_SOUNDBOARD_TRIGGER;
}

export async function validatePersistedSoundboardTrigger(
  value: unknown,
  resolveServerSound: (
    serverId: string,
    soundId: string,
  ) => Promise<AuthorizedSoundboardCatalogEntry | null>,
): Promise<SoundboardTriggerConfig | null> {
  const parsed = parseSoundboardTriggerConfig(value);
  if (!parsed) return null;
  if (!parsed.sound) return parsed;

  if (parsed.sound.source === "custom") return null;
  if (parsed.sound.source === "default") {
    const { mediaUrl: _mediaUrl, ...safeSound } = parsed.sound;
    return { enabled: parsed.enabled, sound: safeSound };
  }

  const serverId = parsed.sound.serverId;
  if (!serverId) return null;
  const catalogSound = await resolveServerSound(serverId, parsed.sound.soundId);
  if (!catalogSound) return null;

  return {
    enabled: parsed.enabled,
    sound: {
      source: "server",
      soundId: catalogSound.id,
      serverId: catalogSound.serverId,
      name: catalogSound.name,
      ...(catalogSound.emoji ? { emoji: catalogSound.emoji } : {}),
      volume: catalogSound.volume,
    },
  };
}

export async function validatePersistedSoundboardTriggerMap(
  value: unknown,
  resolveServerSound: (
    serverId: string,
    soundId: string,
  ) => Promise<AuthorizedSoundboardCatalogEntry | null>,
): Promise<SoundboardTriggerMap | null> {
  const legacy = parseSoundboardTriggerConfig(value);
  if (legacy) {
    const validated = await validatePersistedSoundboardTrigger(
      legacy,
      resolveServerSound,
    );
    return validated ? { [ALL_SERVERS_SOUND_SCOPE]: validated } : null;
  }

  if (!isRecord(value)) return null;
  const result: SoundboardTriggerMap = {};
  for (const [scope, config] of Object.entries(value)) {
    const parsed = parseSoundboardTriggerConfig(config);
    if (!parsed) return null;
    const validated = await validatePersistedSoundboardTrigger(
      parsed,
      resolveServerSound,
    );
    if (!validated) {
      if (parsed.sound?.source === "server") continue;
      return null;
    }
    result[scope] = validated;
  }
  return result;
}
