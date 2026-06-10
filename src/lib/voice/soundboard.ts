import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { getMediaUrl } from "@/lib/platform";

export interface DefaultSound {
  id: string;
  name: string;
  tone: number;
  duration: number;
}

export const DEFAULT_SOUNDBOARD_SOUNDS: DefaultSound[] = [
  { id: "ping", name: "Ping", tone: 880, duration: 0.18 },
  { id: "pop", name: "Pop", tone: 520, duration: 0.14 },
  { id: "chime", name: "Chime", tone: 660, duration: 0.32 },
  { id: "tada", name: "Ta-da", tone: 740, duration: 0.42 },
];

export const MAX_SOUNDBOARD_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_CUSTOM_SOUNDBOARD_SOUNDS = 24;
const PLAYBACK_UI_VISIBLE_AFTER_MS = 500;
const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/;

interface PlaybackController {
  ownerId: string;
  serverKey: string;
  stop: () => void;
  showTimer?: ReturnType<typeof setTimeout>;
}

export interface SoundboardPlayRequest {
  playbackId: string;
  ownerId: string;
  serverKey: string;
  name: string;
  soundId?: string;
  dataUrl?: string;
  mediaUrl?: string;
  volume?: number;
  isLocal?: boolean;
  receivedAt?: number;
}

const activeControllers = new Map<string, PlaybackController>();

export function getSoundboardServerKey(serverId?: string | null) {
  return serverId || "dm-call";
}

function cleanupPlayback(playbackId: string) {
  const controller = activeControllers.get(playbackId);
  if (controller?.showTimer) clearTimeout(controller.showTimer);
  activeControllers.delete(playbackId);
  useVoiceSoundboardStore.getState().removePlayback(playbackId);
}

export function stopSoundboardPlayback(playbackId: string) {
  const controller = activeControllers.get(playbackId);
  if (!controller) return;
  controller.stop();
}

export function stopSoundboardPlaybacksByOwner(ownerId: string, serverKey?: string) {
  for (const controller of activeControllers.values()) {
    if (controller.ownerId !== ownerId) continue;
    if (serverKey && controller.serverKey !== serverKey) continue;
    controller.stop();
  }
}

export function stopAllSoundboardPlaybacksForServer(serverKey: string) {
  for (const controller of activeControllers.values()) {
    if (controller.serverKey !== serverKey) continue;
    controller.stop();
  }
  useVoiceSoundboardStore.getState().clearServerPlaybacks(serverKey);
}

function registerPlayback(
  playbackId: string,
  ownerId: string,
  serverKey: string,
  name: string,
  isLocal: boolean,
  stop: () => void,
) {
  const playback = {
    playbackId,
    ownerId,
    serverKey,
    name,
    isLocal,
    startedAt: Date.now(),
  };
  const controller: PlaybackController = { ownerId, serverKey, stop };
  activeControllers.set(playbackId, controller);
  controller.showTimer = setTimeout(() => {
    if (activeControllers.get(playbackId) !== controller) return;
    controller.showTimer = undefined;
    useVoiceSoundboardStore.getState().upsertPlayback(playback);
  }, PLAYBACK_UI_VISIBLE_AFTER_MS);
}

function dataUrlToObjectUrl(dataUrl: string): string | null {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return null;

  try {
    const mimeType = match[1] || "application/octet-stream";
    const isBase64 = !!match[2];
    const payload = match[3] || "";
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  } catch {
    return null;
  }
}

export function playSoundboardPlayback({
  playbackId,
  ownerId,
  serverKey,
  name,
  soundId,
  dataUrl,
  mediaUrl,
  volume = 0.8,
  isLocal = false,
  receivedAt,
}: SoundboardPlayRequest) {
  stopSoundboardPlayback(playbackId);

  const objectUrl = !mediaUrl && dataUrl?.startsWith("data:") ? dataUrlToObjectUrl(dataUrl) : null;
  const audioSource = mediaUrl ? getMediaUrl(mediaUrl) : objectUrl ?? (dataUrl?.startsWith("data:") ? undefined : dataUrl);
  if (audioSource) {
    const audio = new Audio(audioSource);
    let finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      audio.pause();
      audio.currentTime = 0;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      cleanupPlayback(playbackId);
    };

    registerPlayback(playbackId, ownerId, serverKey, name, isLocal, finalize);
    audio.volume = volume;
    audio.preload = "auto";
    audio.addEventListener("ended", finalize, { once: true });
    audio.addEventListener("error", finalize, { once: true });

    const play = () => {
      if (finished) return;
      const elapsed = receivedAt ? Math.max(0, (Date.now() - receivedAt) / 1000) : 0;
      if (elapsed > 0) {
        if (Number.isFinite(audio.duration) && elapsed >= audio.duration) {
          finalize();
          return;
        }
        try {
          audio.currentTime = elapsed;
        } catch {
          // Some codecs report unknown duration until more bytes are buffered.
        }
      }
      audio.play().catch(finalize);
    };

    if (receivedAt && audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      audio.addEventListener("loadedmetadata", play, { once: true });
      audio.load();
    } else {
      play();
    }
    return;
  }

  const sound = DEFAULT_SOUNDBOARD_SOUNDS.find((entry) => entry.id === soundId) ?? DEFAULT_SOUNDBOARD_SOUNDS[0];
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  const ctx = new AudioContextCtor();
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  let finished = false;

  const finalize = () => {
    if (finished) return;
    finished = true;
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {}
    cleanupPlayback(playbackId);
    void ctx.close().catch(() => {});
  };

  osc.type = sound.id === "pop" ? "triangle" : "sine";
  osc.frequency.value = sound.tone;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + sound.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.onended = finalize;

  registerPlayback(playbackId, ownerId, serverKey, name, isLocal, () => {
    try {
      osc.stop();
    } catch {}
    finalize();
  });

  osc.start();
  osc.stop(ctx.currentTime + sound.duration);
}
