import { apiGet } from "@/lib/api-client";
import {
  DEFAULT_SOUNDBOARD_SOUNDS,
  getSoundboardServerKey,
  MAX_AUTOMATIC_SOUNDBOARD_DURATION_SECONDS,
  playSoundboardPlayback,
  setSoundboardMasterVolume,
} from "@/lib/voice/soundboard";
import { createSoundboardPlaybackId } from "@/lib/voice/soundboard-playback-id";
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
  generation: number;
  joinStarted: boolean;
  joined: boolean;
  leaveStarted: boolean;
  resolvedLeave: SoundboardTriggerSelection | null;
}

export interface AutomaticSoundboardTransport {
  serverKey: string;
  userId: string;
  sendAppEvent: (payload: Record<string, unknown>) => boolean;
  isReady?: () => boolean;
  waitUntilReady?: () => Promise<void>;
}

const sessions = new Map<string, AutomaticSoundboardSession>();
const pendingCleanupTimers = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; onCancel?: () => void }
>();
const SOUND_SELECTION_TIMEOUT_MS = 5000;
const LEAVE_CATALOG_TIMEOUT_MS = 250;
let playbackSequence = 0;
let sessionGeneration = 0;

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
    generation: ++sessionGeneration,
    joinStarted: false,
    joined: false,
    leaveStarted: false,
    resolvedLeave: null,
  };
  sessions.set(sessionId, created);
  return created;
}

async function waitForTransportReady(transport: AutomaticSoundboardTransport) {
  if (!transport.waitUntilReady || transport.isReady?.()) return true;

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    void transport
      .waitUntilReady?.()
      .then(() => {
        clearTimeout(timeout);
        resolve(transport.isReady?.() ?? true);
      })
      .catch(() => {
        clearTimeout(timeout);
        resolve(false);
      });
  });
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
    const sounds = await withTimeout(
      apiGet<ServerSoundboardCatalogItem[]>(
        `/api/servers/${selection.serverId}/soundboard`,
      ),
      SOUND_SELECTION_TIMEOUT_MS,
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Soundboard catalog lookup timed out")),
      timeoutMs,
    );
    void promise.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function resolveSelectionForEvent(
  event: AutomaticSoundboardEvent,
  selection: SoundboardTriggerSelection,
  session: AutomaticSoundboardSession,
) {
  if (event === "leave" && session.resolvedLeave) {
    return session.resolvedLeave;
  }

  if (event === "leave" && selection.source === "server") {
    try {
      const sounds = await withTimeout(
        apiGet<ServerSoundboardCatalogItem[]>(
          `/api/servers/${selection.serverId}/soundboard`,
        ),
        LEAVE_CATALOG_TIMEOUT_MS,
      );
      const catalogSound = sounds.find(
        (sound) => sound.id === selection.soundId,
      );
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

  return resolveSelection(selection);
}

async function cacheLeaveSelection(
  sessionId: string,
  session: AutomaticSoundboardSession,
  serverId?: string | null,
) {
  const settings = useSoundSettingsStore.getState().getSettings();
  if (!settings.soundsEnabled) return;
  const trigger = resolveSoundboardTriggerConfig(
    settings.voiceLeaveSoundboard,
    serverId,
  );
  if (!trigger.enabled || !trigger.sound) return;
  const resolved = await resolveSelection(trigger.sound);
  if (
    !resolved ||
    sessions.get(sessionId) !== session ||
    session.leaveStarted
  ) {
    return;
  }
  session.resolvedLeave = resolved;
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
    includeInVoiceActivity: false,
  });
  return true;
}

export async function playAutomaticSoundboardTrigger(
  event: AutomaticSoundboardEvent,
  sessionId: string,
  serverId?: string | null,
  transport?: AutomaticSoundboardTransport,
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

  const selection = await resolveSelectionForEvent(
    event,
    trigger.sound,
    session,
  );
  if (!selection) return false;
  if (
    sessions.get(sessionId) !== session ||
    (event === "join" && session.leaveStarted)
  )
    return false;
  if (!transport) return false;
  if (
    selection.source === "server" &&
    transport.serverKey !== "dm-call" &&
    selection.serverId !== transport.serverKey
  ) {
    return false;
  }
  if (selection.source === "custom" && transport.serverKey === "dm-call") {
    return false;
  }
  // Leave must stay snappy: only send if the gateway is already ready.
  // Join can wait briefly for reconnect/readiness.
  if (event === "leave") {
    if (transport.isReady && !transport.isReady()) return false;
  } else if (!(await waitForTransportReady(transport))) {
    return false;
  }
  if (
    sessions.get(sessionId) !== session ||
    (event === "join" && session.leaveStarted)
  )
    return false;

  const playbackId = createSoundboardPlaybackId(
    transport.userId,
    `auto:${event}:${++playbackSequence}:${selection.soundId}`,
  );
  const payload = {
    type: "soundboard.play",
    server_key: transport.serverKey,
    user_id: transport.userId,
    playback_id: playbackId,
    sound_id: selection.soundId,
    automatic_event: event,
    max_duration_seconds: MAX_AUTOMATIC_SOUNDBOARD_DURATION_SECONDS,
    name: selection.name,
    ...(transport.serverKey === "dm-call" && selection.serverId
      ? { source_server_id: selection.serverId }
      : {}),
    ...(selection.mediaUrl
      ? { media_url: selection.mediaUrl }
      : selection.dataUrl
        ? { data_url: selection.dataUrl }
        : {}),
    volume:
      clampVolume(selection.volume) * clampVolume(settings.soundVolume / 100),
  };
  const accepted = transport.sendAppEvent(payload);
  if (event === "join" && accepted) {
    void cacheLeaveSelection(sessionId, session, serverId);
  }
  if (accepted) return true;
  if (event === "leave") return false;
  if (!(await waitForTransportReady(transport))) return false;
  if (
    sessions.get(sessionId) !== session ||
    (event === "join" && session.leaveStarted)
  )
    return false;
  return transport.sendAppEvent(payload);
}

export function resetAutomaticSoundboardSession(
  sessionId: string,
  expectedGeneration?: number,
) {
  const session = sessions.get(sessionId);
  if (
    expectedGeneration !== undefined &&
    session?.generation !== expectedGeneration
  ) {
    return;
  }
  cancelAutomaticSoundboardCleanup(sessionId);
  sessions.delete(sessionId);
}

export function hasAutomaticSoundboardLeaveStarted(sessionId: string) {
  return sessions.get(sessionId)?.leaveStarted ?? false;
}

export function getAutomaticSoundboardSessionGeneration(sessionId: string) {
  return sessions.get(sessionId)?.generation;
}

export function cancelAutomaticSoundboardCleanup(sessionId: string) {
  const pending = pendingCleanupTimers.get(sessionId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingCleanupTimers.delete(sessionId);
  pending.onCancel?.();
}

export function scheduleAutomaticSoundboardCleanup(
  sessionId: string,
  serverId?: string | null,
  transport?: AutomaticSoundboardTransport,
  onComplete?: () => void,
  onCancel?: () => void,
) {
  cancelAutomaticSoundboardCleanup(sessionId);
  const expectedGeneration = sessions.get(sessionId)?.generation;
  const timer = setTimeout(() => {
    pendingCleanupTimers.delete(sessionId);
    void playAutomaticSoundboardTrigger(
      "leave",
      sessionId,
      serverId,
      transport,
    ).finally(() => {
      resetAutomaticSoundboardSession(sessionId, expectedGeneration);
      onComplete?.();
    });
  }, 0);
  pendingCleanupTimers.set(sessionId, { timer, onCancel });
}
