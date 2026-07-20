const PLAYBACK_ID_PREFIX = "sb1:";

export type SoundboardPlaybackId = string & {
  readonly __soundboardPlaybackId: unique symbol;
};

export interface ParsedSoundboardPlaybackId {
  ownerId: string;
  soundId: string;
}

export function createSoundboardPlaybackId(
  ownerId: string,
  soundId: string,
): SoundboardPlaybackId {
  if (!ownerId || !soundId) {
    throw new Error("Soundboard playback IDs require an owner and sound");
  }
  return `${PLAYBACK_ID_PREFIX}${ownerId.length}:${ownerId}:${soundId}` as SoundboardPlaybackId;
}

export function parseSoundboardPlaybackId(
  value: unknown,
): ParsedSoundboardPlaybackId | null {
  if (typeof value !== "string" || !value.startsWith(PLAYBACK_ID_PREFIX)) {
    return null;
  }

  const lengthSeparator = value.indexOf(":", PLAYBACK_ID_PREFIX.length);
  if (lengthSeparator < 0) return null;

  const lengthText = value.slice(PLAYBACK_ID_PREFIX.length, lengthSeparator);
  if (!/^(?:0|[1-9]\d*)$/.test(lengthText)) return null;

  const ownerLength = Number(lengthText);
  const ownerStart = lengthSeparator + 1;
  const ownerEnd = ownerStart + ownerLength;
  if (
    ownerLength <= 0 ||
    !Number.isSafeInteger(ownerLength) ||
    value[ownerEnd] !== ":"
  ) {
    return null;
  }

  const ownerId = value.slice(ownerStart, ownerEnd);
  const soundId = value.slice(ownerEnd + 1);
  return ownerId && soundId ? { ownerId, soundId } : null;
}

export function isSoundboardPlaybackOwnedBy(
  playbackId: string,
  ownerId: string,
): boolean {
  return parseSoundboardPlaybackId(playbackId)?.ownerId === ownerId;
}

export function isLegacySoundboardPlaybackOwnedBy(
  playbackId: string,
  ownerId: string,
  soundId: string,
): boolean {
  return !!ownerId && !!soundId && playbackId === `s-${ownerId}-${soundId}`;
}
