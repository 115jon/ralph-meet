import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";

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

export const MAX_SOUNDBOARD_UPLOAD_BYTES = 1024 * 1024;
export const MAX_SOUNDBOARD_DURATION_SECONDS = 12;
export const MAX_CUSTOM_SOUNDBOARD_SOUNDS = 24;

interface PlaybackController {
  ownerId: string;
  serverKey: string;
  stop: () => void;
}

export interface SoundboardPlayRequest {
  playbackId: string;
  ownerId: string;
  serverKey: string;
  name: string;
  soundId?: string;
  dataUrl?: string;
  volume?: number;
  isLocal?: boolean;
}

const activeControllers = new Map<string, PlaybackController>();

export function getSoundboardServerKey(serverId?: string | null) {
  return serverId || "dm-call";
}

function cleanupPlayback(playbackId: string) {
  activeControllers.delete(playbackId);
  useVoiceSoundboardStore.getState().removePlayback(playbackId);
}

export function stopSoundboardPlayback(playbackId: string) {
  const controller = activeControllers.get(playbackId);
  if (!controller) return;
  controller.stop();
}

export function stopSoundboardPlaybacksByOwner(ownerId: string, serverKey?: string) {
  for (const [playbackId, controller] of activeControllers.entries()) {
    if (controller.ownerId !== ownerId) continue;
    if (serverKey && controller.serverKey !== serverKey) continue;
    controller.stop();
  }
}

export function stopAllSoundboardPlaybacksForServer(serverKey: string) {
  for (const [playbackId, controller] of activeControllers.entries()) {
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
  activeControllers.set(playbackId, { ownerId, serverKey, stop });
  useVoiceSoundboardStore.getState().upsertPlayback({
    playbackId,
    ownerId,
    serverKey,
    name,
    isLocal,
    startedAt: Date.now(),
  });
}

export function playSoundboardPlayback({
  playbackId,
  ownerId,
  serverKey,
  name,
  soundId,
  dataUrl,
  volume = 0.8,
  isLocal = false,
}: SoundboardPlayRequest) {
  stopSoundboardPlayback(playbackId);

  if (dataUrl) {
    const audio = new Audio(dataUrl);
    let finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      audio.pause();
      audio.currentTime = 0;
      cleanupPlayback(playbackId);
    };

    registerPlayback(playbackId, ownerId, serverKey, name, isLocal, finalize);
    audio.volume = volume;
    audio.preload = "auto";
    audio.addEventListener("ended", finalize, { once: true });
    audio.addEventListener("error", finalize, { once: true });
    audio.play().catch(finalize);
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

export async function readSoundboardFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read sound file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function getAudioDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read audio metadata"));
    };
  });
}
