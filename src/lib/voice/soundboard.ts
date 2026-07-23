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
const PLAYBACK_UI_VISIBLE_AFTER_MS = 500;
const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/;
const MAX_SOUNDBOARD_EVENT_PAST_SKEW_MS = 5_000;
const MAX_SOUNDBOARD_EVENT_FUTURE_SKEW_MS = 5_000;
export const MAX_AUTOMATIC_SOUNDBOARD_DURATION_SECONDS = 3;

interface PlaybackController {
  playbackId: string;
  ownerId: string;
  serverKey: string;
  stop: () => void;
  includeInVoiceActivity: boolean;
  playing: boolean;
  pause?: () => void;
  resume?: () => void;
  setVolume?: (volume: number) => void;
  paused?: boolean;
  volume?: number;
  rawVolume?: number;
  showTimer?: ReturnType<typeof setTimeout>;
  automaticEvent?: "join" | "leave";
  automaticStopTimer?: ReturnType<typeof setTimeout>;
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
  includeInVoiceActivity?: boolean;
  receivedAt?: number;
  mediaCapabilityExpiresAt?: number;
  currentTime?: number;
  paused?: boolean;
  automaticEvent?: "join" | "leave";
  maxDurationSeconds?: number;
  renewCapability?: (state: {
    currentTime: number;
    paused: boolean;
  }) => boolean;
}

const activeControllers = new Map<string, PlaybackController>();
const soundboardActivityListeners = new Set<() => void>();

function getPlaybackKey(playbackId: string, serverKey: string): string {
  return `${serverKey}::${playbackId}`;
}

function normalizeVolume(volume: number) {
  return Math.max(0, Math.min(1, volume));
}

function notifySoundboardActivity() {
  for (const listener of soundboardActivityListeners) listener();
}

function isCurrentPlayback(playbackId: string, controller: PlaybackController) {
  return (
    activeControllers.get(getPlaybackKey(playbackId, controller.serverKey)) ===
    controller
  );
}

function updatePlaybackActivityState(
  playbackId: string,
  controller: PlaybackController,
  next: { paused?: boolean; playing?: boolean },
) {
  if (!isCurrentPlayback(playbackId, controller)) return;

  const changed =
    (next.paused !== undefined && controller.paused !== next.paused) ||
    (next.playing !== undefined && controller.playing !== next.playing);
  if (!changed) return;

  if (next.paused !== undefined) controller.paused = next.paused;
  if (next.playing !== undefined) controller.playing = next.playing;
  useVoiceSoundboardStore
    .getState()
    .setPlaybackPaused(
      playbackId,
      controller.paused ?? false,
      controller.serverKey,
    );
  notifySoundboardActivity();
}

export function getSoundboardServerKey(serverId?: string | null) {
  return serverId || "dm-call";
}

export function hasActiveSoundboardPlayback(
  ownerId: string,
  serverKey: string,
): boolean {
  for (const controller of activeControllers.values()) {
    if (
      controller.ownerId === ownerId &&
      controller.serverKey === serverKey &&
      controller.includeInVoiceActivity &&
      controller.playing &&
      !controller.paused &&
      (controller.volume ?? 0) > 0
    ) {
      return true;
    }
  }
  return false;
}

export function subscribeSoundboardActivity(listener: () => void) {
  soundboardActivityListeners.add(listener);
  return () => soundboardActivityListeners.delete(listener);
}

export function getSoundboardEventReceivedAt(
  sentAt: unknown,
  now = Date.now(),
): number {
  if (
    !Number.isSafeInteger(now) ||
    typeof sentAt !== "number" ||
    !Number.isSafeInteger(sentAt) ||
    sentAt <= 0 ||
    sentAt < now - MAX_SOUNDBOARD_EVENT_PAST_SKEW_MS ||
    sentAt > now + MAX_SOUNDBOARD_EVENT_FUTURE_SKEW_MS
  ) {
    return now;
  }
  return Math.min(sentAt, now);
}

function cleanupPlayback(
  playbackId: string,
  expectedController: PlaybackController,
) {
  const controller = activeControllers.get(
    getPlaybackKey(playbackId, expectedController.serverKey),
  );
  if (controller !== expectedController) return;
  if (controller?.showTimer) clearTimeout(controller.showTimer);
  if (controller?.automaticStopTimer)
    clearTimeout(controller.automaticStopTimer);
  controller.playing = false;
  activeControllers.delete(
    getPlaybackKey(playbackId, expectedController.serverKey),
  );
  useVoiceSoundboardStore
    .getState()
    .removePlayback(playbackId, expectedController.serverKey);
  notifySoundboardActivity();
}

export function stopSoundboardPlayback(playbackId: string, serverKey?: string) {
  const controller = serverKey
    ? activeControllers.get(getPlaybackKey(playbackId, serverKey))
    : [...activeControllers.values()].find(
        (candidate) => candidate.playbackId === playbackId,
      );
  if (!controller) return;
  controller.stop();
}

export function pauseSoundboardPlayback(
  playbackId: string,
  serverKey?: string,
) {
  const controller = serverKey
    ? activeControllers.get(getPlaybackKey(playbackId, serverKey))
    : [...activeControllers.values()].find(
        (candidate) => candidate.playbackId === playbackId,
      );
  controller?.pause?.();
}

export function resumeSoundboardPlayback(
  playbackId: string,
  serverKey?: string,
) {
  const controller = serverKey
    ? activeControllers.get(getPlaybackKey(playbackId, serverKey))
    : [...activeControllers.values()].find(
        (candidate) => candidate.playbackId === playbackId,
      );
  controller?.resume?.();
}

export function setSoundboardPlaybackVolume(
  playbackId: string,
  volume: number,
  serverKey?: string,
) {
  const controller = serverKey
    ? activeControllers.get(getPlaybackKey(playbackId, serverKey))
    : [...activeControllers.values()].find(
        (candidate) => candidate.playbackId === playbackId,
      );
  controller?.setVolume?.(normalizeVolume(volume));
}

export function stopSoundboardPlaybacksByOwner(
  ownerId: string,
  serverKey?: string,
) {
  for (const controller of activeControllers.values()) {
    if (controller.ownerId !== ownerId) continue;
    if (serverKey && controller.serverKey !== serverKey) continue;
    controller.stop();
  }
}

export function stopAutomaticJoinSoundboardPlaybacksByOwner(
  ownerId: string,
  serverKey?: string,
) {
  for (const controller of activeControllers.values()) {
    if (controller.ownerId !== ownerId) continue;
    if (serverKey && controller.serverKey !== serverKey) continue;
    if (controller.automaticEvent !== "join") continue;
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
  volume: number,
  controller: PlaybackController,
) {
  const startedAt = Date.now();
  controller.paused = controller.paused ?? false;
  controller.playing = controller.playing ?? false;
  controller.volume = volume;
  activeControllers.set(
    getPlaybackKey(playbackId, controller.serverKey),
    controller,
  );
  controller.showTimer = setTimeout(() => {
    if (!isCurrentPlayback(playbackId, controller)) return;
    controller.showTimer = undefined;
    useVoiceSoundboardStore.getState().upsertPlayback({
      playbackId,
      ownerId,
      serverKey,
      name,
      isLocal,
      startedAt,
      paused: controller.paused ?? false,
      volume: controller.volume ?? volume,
    });
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

let masterVolume = 1.0;
if (typeof localStorage !== "undefined") {
  masterVolume = Number(
    localStorage.getItem("voice-soundboard:master-volume") ?? "1",
  );
}

export function setSoundboardMasterVolume(volume: number) {
  masterVolume = volume;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("voice-soundboard:master-volume", volume.toString());
  }
  for (const controller of activeControllers.values()) {
    if (controller.setVolume && controller.rawVolume !== undefined) {
      controller.setVolume(controller.rawVolume * masterVolume);
    }
  }
}

export function getSoundboardMasterVolume() {
  return masterVolume;
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
  includeInVoiceActivity = true,
  receivedAt,
  mediaCapabilityExpiresAt,
  currentTime,
  paused = false,
  renewCapability,
  automaticEvent,
  maxDurationSeconds,
}: SoundboardPlayRequest) {
  // If the same playbackId is received again (e.g. deterministic ID for spam clicks),
  // we let it proceed to stopSoundboardPlayback and restart the audio buffer.
  // We removed the early return here to support restarting the same sound.

  stopSoundboardPlayback(playbackId, serverKey);
  const initialVolume = normalizeVolume(volume) * masterVolume;

  const objectUrl =
    !mediaUrl && dataUrl?.startsWith("data:")
      ? dataUrlToObjectUrl(dataUrl)
      : null;
  const audioSource = mediaUrl
    ? getMediaUrl(mediaUrl)
    : (objectUrl ?? (dataUrl?.startsWith("data:") ? undefined : dataUrl));
  if (audioSource) {
    const audio = new Audio(audioSource);
    let finished = false;
    let requestedPaused = paused;
    let renewalRequested = false;
    let controller: PlaybackController | null = null;
    const syncPausedState = (paused: boolean) => {
      if (!controller || !isCurrentPlayback(playbackId, controller)) return;
      updatePlaybackActivityState(playbackId, controller, {
        paused,
        playing: paused ? false : undefined,
      });
    };
    const finalize = () => {
      if (finished) return;
      finished = true;
      audio.pause();
      audio.currentTime = 0;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (controller) cleanupPlayback(playbackId, controller);
    };

    const requestCapabilityRenewal = (
      force = false,
      pausedOverride?: boolean,
    ) => {
      if (
        finished ||
        !controller ||
        !isCurrentPlayback(playbackId, controller) ||
        !renewCapability ||
        renewalRequested ||
        typeof mediaCapabilityExpiresAt !== "number" ||
        !Number.isFinite(mediaCapabilityExpiresAt) ||
        (!force && Date.now() < mediaCapabilityExpiresAt)
      ) {
        return false;
      }

      renewalRequested = true;
      if (
        !renewCapability({
          currentTime:
            Number.isFinite(audio.currentTime) && audio.currentTime >= 0
              ? audio.currentTime
              : 0,
          paused: pausedOverride ?? requestedPaused,
        })
      ) {
        renewalRequested = false;
        return false;
      }
      syncPausedState(true);
      return true;
    };

    const startAudio = () => {
      if (finished || requestedPaused) return;
      void audio.play().then(
        () => syncPausedState(false),
        () => {
          if (!requestCapabilityRenewal()) finalize();
        },
      );
    };

    controller = {
      playbackId,
      ownerId,
      serverKey,
      stop: finalize,
      includeInVoiceActivity,
      playing: false,
      paused: requestedPaused,
      automaticEvent,
      pause: () => {
        if (finished) return;
        requestedPaused = true;
        if (!audio.paused) audio.pause();
        syncPausedState(true);
      },
      resume: () => {
        if (finished) return;
        requestedPaused = false;
        if (requestCapabilityRenewal(false, false)) return;
        startAudio();
      },
      setVolume: (nextVolume) => {
        if (!controller || !isCurrentPlayback(playbackId, controller)) return;
        audio.volume = nextVolume;
        controller.volume = nextVolume;
        useVoiceSoundboardStore
          .getState()
          .setPlaybackVolume(playbackId, nextVolume, serverKey);
        notifySoundboardActivity();
      },
    };
    registerPlayback(
      playbackId,
      ownerId,
      serverKey,
      name,
      isLocal,
      initialVolume,
      controller,
    );
    controller.rawVolume = normalizeVolume(volume);
    if (automaticEvent) {
      const durationSeconds = Math.min(
        MAX_AUTOMATIC_SOUNDBOARD_DURATION_SECONDS,
        Math.max(
          0,
          maxDurationSeconds ?? MAX_AUTOMATIC_SOUNDBOARD_DURATION_SECONDS,
        ),
      );
      if (controller) {
        controller.automaticStopTimer = setTimeout(
          finalize,
          durationSeconds * 1000,
        );
      }
    }

    audio.volume = initialVolume;
    audio.preload = "auto";
    audio.addEventListener("pause", () => {
      if (finished) return;
      syncPausedState(true);
    });
    audio.addEventListener("play", () => {
      if (finished) return;
      syncPausedState(false);
      if (controller) {
        updatePlaybackActivityState(playbackId, controller, {
          paused: false,
          playing: true,
        });
      }
    });
    audio.addEventListener("ended", finalize, { once: true });
    audio.addEventListener(
      "error",
      () => {
        if (!requestCapabilityRenewal(true)) finalize();
      },
      { once: true },
    );

    const play = () => {
      if (finished) return;
      const deliveryLatencySeconds =
        receivedAt && !requestedPaused
          ? Math.max(0, (Date.now() - receivedAt) / 1000)
          : 0;
      const elapsed =
        typeof currentTime === "number" &&
        Number.isFinite(currentTime) &&
        currentTime >= 0
          ? currentTime + deliveryLatencySeconds
          : deliveryLatencySeconds;
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
      if (requestedPaused) {
        syncPausedState(true);
        return;
      }
      startAudio();
    };

    if (receivedAt && audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      audio.addEventListener("loadedmetadata", play, { once: true });
      audio.load();
    } else {
      play();
    }
    return;
  }

  const sound = DEFAULT_SOUNDBOARD_SOUNDS.find((entry) => entry.id === soundId);
  if (!sound) return;
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return;

  const ctx = new AudioContextCtor();
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  let finished = false;
  let controller: PlaybackController | null = null;

  const finalize = () => {
    if (finished) return;
    finished = true;
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {}
    if (controller) cleanupPlayback(playbackId, controller);
    void ctx.close().catch(() => {});
  };

  osc.type = sound.id === "pop" ? "triangle" : "sine";
  osc.frequency.value = sound.tone;
  gain.gain.setValueAtTime(initialVolume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + sound.duration,
  );
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.onended = finalize;

  controller = {
    playbackId,
    ownerId,
    serverKey,
    stop: () => {
      try {
        osc.stop();
      } catch {}
      finalize();
    },
    includeInVoiceActivity,
    playing: false,
    paused: false,
    setVolume: (nextVolume) => {
      if (!controller || !isCurrentPlayback(playbackId, controller)) return;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(nextVolume, ctx.currentTime);
      controller.volume = nextVolume;
      useVoiceSoundboardStore
        .getState()
        .setPlaybackVolume(playbackId, nextVolume, serverKey);
      notifySoundboardActivity();
    },
    automaticEvent,
  };
  registerPlayback(
    playbackId,
    ownerId,
    serverKey,
    name,
    isLocal,
    initialVolume,
    controller,
  );
  controller.rawVolume = normalizeVolume(volume);

  let oscillatorStarted = false;
  const startOscillator = () => {
    if (finished || oscillatorStarted) return;
    oscillatorStarted = true;
    osc.start();
    if (controller) controller.playing = true;
    notifySoundboardActivity();
    osc.stop(ctx.currentTime + sound.duration);
  };

  if (ctx.state === "running") {
    startOscillator();
  } else {
    void ctx.resume().then(
      () => {
        if (ctx.state === "running") startOscillator();
        else finalize();
      },
      () => finalize(),
    );
  }
}
