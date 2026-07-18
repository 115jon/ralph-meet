import type {
  SoundboardTriggerSelection,
  SoundboardTriggerSource,
} from "@/lib/voice/soundboard-trigger";

export interface SoundboardCatalogSound {
  id: string;
  name: string;
  source?: SoundboardTriggerSource;
  serverId?: string;
  dataUrl?: string;
  mediaUrl?: string;
  emoji?: string;
  volume?: number;
}

export function toSoundboardCatalogSound(
  sound: Omit<SoundboardCatalogSound, "source"> & {
    source?: SoundboardTriggerSource;
  },
  source: SoundboardTriggerSource = "custom",
): SoundboardCatalogSound {
  return { ...sound, source: sound.source ?? source };
}

export function toSoundboardTriggerSelection(
  sound: SoundboardCatalogSound,
): SoundboardTriggerSelection {
  return {
    source: sound.source ?? "custom",
    soundId: sound.id,
    name: sound.name,
    ...(sound.serverId ? { serverId: sound.serverId } : {}),
    ...(sound.dataUrl ? { dataUrl: sound.dataUrl } : {}),
    ...(sound.mediaUrl && sound.source !== "server"
      ? { mediaUrl: sound.mediaUrl }
      : {}),
    ...(sound.emoji ? { emoji: sound.emoji } : {}),
    volume: sound.volume ?? 1,
  };
}
