import { apiGet } from "@/lib/api-client";
import {
  DEFAULT_SOUNDBOARD_SOUNDS,
  getSoundboardServerKey,
  playSoundboardPlayback,
  setSoundboardMasterVolume,
} from "@/lib/voice/soundboard";
import {
  resolveSoundboardTriggerConfig,
  type SoundboardTriggerSelection,
} from "@/lib/voice/soundboard-trigger";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";

type AutomaticSoundboardEvent = "join" | "leave";

interface ServerSoundboardCatalogItem {
  id: string;
  name: string;
  file_url?: string;
  emoji?: string;
  volume?: number;
}

interface AutomaticSoundboardSession {
  joinStarted: boolean;
  joined: boolean;
  leaveStarted: boolean;
}

const sessions = new Map<string, AutomaticSoundboardSession>();
const pendingCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
let playbackSequence = 0;

export function getAutomaticSoundboardSessionId(
  mode: "channel" | "call" | "room",
  roomSlug: string,
) {
  return `${mode}:${roomSlug}`;
}

function getSession(sessionId: string) {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created: AutomaticSoundboardSession = {
    joinStarted: false,
    joined: false,
    leaveStarted: false,
  };
  sessions.set(sessionId, created);
  return created;
}

function clampVolume(value: number) {
  return Math.max(0, Math.min(1, value));
}

async function resolveSelection(selection: SoundboardTriggerSelection) {
  if (selection.source === "default") {
    return DEFAULT_SOUNDBOARD_SOUNDS.some(
      (sound) => sound.id === selection.soundId,
    )
      ? selection
      : null;
  }

  if (selection.source === "custom") {
    return selection.mediaUrl || selection.dataUrl ? selection : null;
  }

  if (!selection.serverId) return null;
  try {
    const sounds = await apiGet<ServerSoundboardCatalogItem[]>(
      `/api/servers/${selection.serverId}/soundboard`,
    );
    const catalogSound = sounds.find((sound) => sound.id === selection.soundId);
    if (!catalogSound?.file_url) return null;
    return {
      ...selection,
      name: catalogSound.name,
      mediaUrl: catalogSound.file_url,
      emoji: catalogSound.emoji,
      volume: clampVolume(catalogSound.volume ?? selection.volume),
    };
  } catch {
    return null;
  }
}

export async function previewSoundboardTriggerSelection(
  selection: SoundboardTriggerSelection,
  ownerId = "settings-preview",
): Promise<boolean> {
  const settings = useSoundSettingsStore.getState().getSettings();
  if (!settings.soundsEnabled) return false;
  setSoundboardMasterVolume(settings.soundboardVolume / 100);
  const resolved = await resolveSelection(selection);
  if (!resolved) return false;
  playSoundboardPlayback({
    playbackId: "settings-preview",
    ownerId,
    serverKey: getSoundboardServerKey(resolved.serverId),
    name: `Preview: ${resolved.name}`,
    soundId: resolved.soundId,
    dataUrl: resolved.dataUrl,
    mediaUrl: resolved.mediaUrl,
    volume:
      clampVolume(resolved.volume) * clampVolume(settings.soundVolume / 100),
    isLocal: true,
  });
  return true;
}

export async function playAutomaticSoundboardTrigger(
  event: AutomaticSoundboardEvent,
  sessionId: string,
  serverId?: string | null,
): Promise<boolean> {
  const session = getSession(sessionId);
  if (event === "join") {
    if (session.joinStarted) return false;
    session.joinStarted = true;
    session.joined = true;
  } else {
    if (!session.joined || session.leaveStarted) return false;
    session.leaveStarted = true;
  }

  const settings = useSoundSettingsStore.getState().getSettings();
  if (!settings.soundsEnabled) return false;
  setSoundboardMasterVolume(settings.soundboardVolume / 100);
  const trigger =
    event === "join"
      ? resolveSoundboardTriggerConfig(settings.voiceJoinSoundboard, serverId)
      : resolveSoundboardTriggerConfig(settings.voiceLeaveSoundboard, serverId);
  if (!trigger.enabled || !trigger.sound) return false;

  const selection = await resolveSelection(trigger.sound);
  if (!selection) return false;
  if (sessions.get(sessionId) !== session) return false;

  const playbackId = `auto-soundboard:${sessionId}:${event}:${++playbackSequence}`;
  playSoundboardPlayback({
    playbackId,
    ownerId: `auto-soundboard:${sessionId}`,
    serverKey: getSoundboardServerKey(selection.serverId),
    name: selection.name,
    soundId: selection.soundId,
    dataUrl: selection.dataUrl,
    mediaUrl: selection.mediaUrl,
    volume:
      clampVolume(selection.volume) * clampVolume(settings.soundVolume / 100),
    isLocal: true,
  });
  return true;
}

export function resetAutomaticSoundboardSession(sessionId: string) {
  const timer = pendingCleanupTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  pendingCleanupTimers.delete(sessionId);
  sessions.delete(sessionId);
}

export function hasAutomaticSoundboardLeaveStarted(sessionId: string) {
  return sessions.get(sessionId)?.leaveStarted ?? false;
}

export function cancelAutomaticSoundboardCleanup(sessionId: string) {
  const timer = pendingCleanupTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  pendingCleanupTimers.delete(sessionId);
}

export function scheduleAutomaticSoundboardCleanup(
  sessionId: string,
  serverId?: string | null,
) {
  cancelAutomaticSoundboardCleanup(sessionId);
  const timer = setTimeout(() => {
    pendingCleanupTimers.delete(sessionId);
    void playAutomaticSoundboardTrigger("leave", sessionId, serverId).finally(
      () => {
        resetAutomaticSoundboardSession(sessionId);
      },
    );
  }, 0);
  pendingCleanupTimers.set(sessionId, timer);
}
