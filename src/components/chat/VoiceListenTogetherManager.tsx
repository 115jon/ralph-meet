import { clog } from "@/lib/console-logger";
import {
  getDesktopAuthHandoffToken,
  subscribeDesktopTokenChanges,
} from "@/lib/desktop-auth";
import {
  getListenTogetherPositionMs,
  getListenTogetherTrackDuration,
  type ListenTogetherTrack,
  type ListenTogetherStateSnapshot,
} from "@/lib/listen-together";
import type { SFUClient } from "@/lib/sfu-client";
import {
  buildListenTogetherStreamUrl,
  detectPreferredListenTogetherAudioFormat,
  getListenTogetherPlaybackPlan,
  isExpectedListenTogetherPlayCancellation,
} from "@/lib/voice/listen-together-player";
import { ListenTogetherAudioProcessor } from "@/lib/voice/listen-together-audio";
import { useListenTogetherAudioSettingsStore } from "@/stores/useListenTogetherAudioSettingsStore";
import {
  type ListenTogetherLocalPlayback,
  useListenTogetherStore,
} from "@/stores/useListenTogetherStore";
import { useEffect, useRef, useState } from "react";

interface VoiceListenTogetherManagerProps {
  sfu: SFUClient | null;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  serverId?: string | null;
  channelId?: string | null;
}

function isListenTogetherEvent(event: Record<string, unknown>) {
  return (
    typeof event.type === "string" && event.type.startsWith("listen_together.")
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return isFiniteNonNegative(value) && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isListenTogetherTrack(value: unknown): value is ListenTogetherTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  const optionalText = (field: unknown) =>
    field === undefined || field === null || typeof field === "string";
  if (
    typeof track.id !== "string" ||
    typeof track.title !== "string" ||
    typeof track.provider !== "string" ||
    typeof track.canonicalUrl !== "string" ||
    typeof track.sourceLabel !== "string"
  ) {
    return false;
  }
  if (
    !optionalText(track.artist) ||
    !optionalText(track.album) ||
    !optionalText(track.artworkUrl) ||
    !optionalText(track.sourceUrl)
  ) {
    return false;
  }
  if (track.kind === "music") {
    return (
      (track.provider === "youtube" ||
        track.provider === "youtube_music" ||
        track.provider === "spotify") &&
      typeof track.videoId === "string" &&
      isFiniteNonNegativeInteger(track.durationMs)
    );
  }
  return (
    track.kind === "radio" &&
    track.provider === "radio" &&
    typeof track.streamUrl === "string" &&
    optionalText(track.station_uuid)
  );
}

function isListenTogetherQueueEntry(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const requester = entry.requester;
  const optionalText = (field: unknown) =>
    field === undefined || field === null || typeof field === "string";
  return (
    typeof entry.entryId === "string" &&
    isFiniteNonNegativeInteger(entry.requestedAt) &&
    isListenTogetherTrack(entry.track) &&
    requester !== null &&
    typeof requester === "object" &&
    typeof (requester as { userId?: unknown }).userId === "string" &&
    typeof (requester as { displayName?: unknown }).displayName === "string" &&
    optionalText((requester as { avatarUrl?: unknown }).avatarUrl) &&
    optionalText((requester as { avatarDisplay?: unknown }).avatarDisplay) &&
    optionalText(entry.importBatchId) &&
    optionalText(entry.importBatchLabel)
  );
}

function areListenTogetherQueueEntriesEqual(first: unknown, second: unknown) {
  if (
    !isListenTogetherQueueEntry(first) ||
    !isListenTogetherQueueEntry(second)
  ) {
    return false;
  }
  const firstEntry = first as Record<string, unknown>;
  const secondEntry = second as Record<string, unknown>;
  const firstRequester = firstEntry.requester as Record<string, unknown>;
  const secondRequester = secondEntry.requester as Record<string, unknown>;
  const firstTrack = firstEntry.track as Record<string, unknown>;
  const secondTrack = secondEntry.track as Record<string, unknown>;
  const trackFields = [
    "kind",
    "id",
    "provider",
    "videoId",
    "title",
    "artist",
    "album",
    "durationMs",
    "artworkUrl",
    "canonicalUrl",
    "sourceUrl",
    "sourceLabel",
    "station_uuid",
    "streamUrl",
  ];
  return (
    firstEntry.entryId === secondEntry.entryId &&
    firstEntry.requestedAt === secondEntry.requestedAt &&
    firstEntry.importBatchId === secondEntry.importBatchId &&
    firstEntry.importBatchLabel === secondEntry.importBatchLabel &&
    firstRequester.userId === secondRequester.userId &&
    firstRequester.displayName === secondRequester.displayName &&
    firstRequester.avatarUrl === secondRequester.avatarUrl &&
    firstRequester.avatarDisplay === secondRequester.avatarDisplay &&
    trackFields.every((field) => firstTrack[field] === secondTrack[field])
  );
}

function isListenTogetherSnapshot(
  value: unknown,
): value is ListenTogetherStateSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  const currentEntry = snapshot.currentEntry;
  const queue = snapshot.queue;
  const recentlyPlayed = snapshot.recentlyPlayed;
  const queueEntries = Array.isArray(queue) ? queue : [];
  const queueIds = queueEntries.map((entry) =>
    entry && typeof entry === "object"
      ? (entry as { entryId?: unknown }).entryId
      : undefined,
  );
  const currentEntryId = snapshot.currentEntryId;
  const queuedCurrentEntry = queueEntries.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry as { entryId?: unknown }).entryId === currentEntryId,
  );
  const currentTrack =
    currentEntry && typeof currentEntry === "object"
      ? (currentEntry as { track?: unknown }).track
      : null;
  const expectedDuration = isListenTogetherTrack(currentTrack)
    ? getListenTogetherTrackDuration(currentTrack)
    : null;
  return (
    isNonEmptyString(snapshot.roomSlug) &&
    isFiniteNonNegativeInteger(snapshot.revision) &&
    typeof snapshot.paused === "boolean" &&
    (typeof currentEntryId === "string" || currentEntryId === null) &&
    isFiniteNonNegativeInteger(snapshot.anchorPositionMs) &&
    (isFiniteNonNegativeInteger(snapshot.anchorUpdatedAt) ||
      snapshot.anchorUpdatedAt === null) &&
    isFiniteNonNegativeInteger(snapshot.lastUpdatedAt) &&
    Array.isArray(queue) &&
    queue.every(isListenTogetherQueueEntry) &&
    new Set(queueIds).size === queueIds.length &&
    (currentEntry === null || isListenTogetherQueueEntry(currentEntry)) &&
    (currentEntry !== null || queue.length === 0) &&
    ((currentEntry === null && currentEntryId === null) ||
      (currentEntry !== null &&
        currentEntryId === (currentEntry as { entryId: string }).entryId &&
        queueIds.includes(currentEntryId) &&
        areListenTogetherQueueEntriesEqual(
          currentEntry,
          queuedCurrentEntry,
        ))) &&
    isFiniteNonNegativeInteger(snapshot.positionMs) &&
    snapshot.durationMs === expectedDuration &&
    (snapshot.anchorUpdatedAt === null ||
      isFiniteNonNegativeInteger(snapshot.anchorUpdatedAt)) &&
    (snapshot.paused ||
      currentEntry === null ||
      snapshot.anchorUpdatedAt !== null) &&
    (currentEntry !== null ||
      (snapshot.paused &&
        snapshot.anchorPositionMs === 0 &&
        snapshot.positionMs === 0 &&
        snapshot.durationMs === null)) &&
    (recentlyPlayed === undefined ||
      (Array.isArray(recentlyPlayed) &&
        recentlyPlayed.every(
          (history) =>
            history !== null &&
            typeof history === "object" &&
            typeof (history as { historyId?: unknown }).historyId ===
              "string" &&
            isFiniteNonNegativeInteger(
              (history as { playedAt?: unknown }).playedAt,
            ) &&
            isListenTogetherQueueEntry((history as { entry?: unknown }).entry),
        )))
  );
}

function getTrackIdentifier(
  track: NonNullable<ListenTogetherStateSnapshot["currentEntry"]>["track"],
): string {
  return track.kind === "music" ? track.videoId : track.id;
}

const log = clog("ListenTogether");

function redactListenTogetherStreamUrl(rawUrl: string | null) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(
      rawUrl,
      typeof window !== "undefined"
        ? window.location.origin
        : "https://meet.115jon.site",
    );
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", "[redacted]");
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/([?&]token=)[^&]+/i, "$1[redacted]");
  }
}

export function VoiceListenTogetherManager({
  sfu,
  roomSlug,
  voiceSessionId,
  serverId,
  channelId,
}: VoiceListenTogetherManagerProps) {
  const snapshot = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.snapshot ?? null) : null,
  );
  const currentEntryId = snapshot?.currentEntry?.entryId ?? null;
  const localVolume = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.localVolume ?? 1) : 1,
  );
  const localPlayback = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.localPlayback ?? null) : null,
  );
  const playbackError = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.playbackError ?? null) : null,
  );
  const clearPlaybackError = useListenTogetherStore(
    (state) => state.clearPlaybackError,
  );
  const loudnessEnabled = useListenTogetherAudioSettingsStore(
    (state) => state.enabled,
  );
  const loudnessPreset = useListenTogetherAudioSettingsStore(
    (state) => state.preset,
  );
  const ensureRoom = useListenTogetherStore((state) => state.ensureRoom);
  const setSnapshot = useListenTogetherStore((state) => state.setSnapshot);
  const setLocalPlayback = useListenTogetherStore(
    (state) => state.setLocalPlayback,
  );
  const clearLocalPlaybackIfMatches = useListenTogetherStore(
    (state) => state.clearLocalPlaybackIfMatches,
  );
  const setError = useListenTogetherStore((state) => state.setError);
  const clearRoom = useListenTogetherStore((state) => state.clearRoom);

  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const radioAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioProcessorRef = useRef(new ListenTogetherAudioProcessor());
  const audioProcessorConnectedRef = useRef(false);
  const musicSrcRef = useRef<string | null>(null);
  const radioSrcRef = useRef<string | null>(null);
  const preferredFormatRef = useRef(detectPreferredListenTogetherAudioFormat());
  const playbackRetryKeyRef = useRef<string | null>(null);
  const playbackGenerationRef = useRef(0);
  const playbackGenerationKeyRef = useRef<string | null>(null);
  const pendingNativePauseTimersRef = useRef(
    new Map<
      HTMLAudioElement,
      {
        timer: ReturnType<typeof setTimeout>;
        playback: ListenTogetherLocalPlayback;
        roomSlug: string;
      }
    >(),
  );
  const suppressedNativeEventsRef = useRef(
    new WeakMap<HTMLAudioElement, Set<"play" | "pause">>(),
  );
  const snapshotRef = useRef<ListenTogetherStateSnapshot | null>(null);
  const roomSlugRef = useRef<string | null>(roomSlug ?? null);
  const playbackErrorRef = useRef(playbackError);
  const awaitingAuthoritativeSnapshotRef = useRef(false);
  const hasCreatedAudioElementsRef = useRef(false);
  const audioElementsReplacedRef = useRef(false);
  const authorityRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [audioContextRevision, setAudioContextRevision] = useState(0);
  const [playbackSyncEpoch, setPlaybackSyncEpoch] = useState(0);
  const [desktopAuthToken, setDesktopAuthToken] = useState<string | null>(() =>
    getDesktopAuthHandoffToken(),
  );
  useEffect(() => {
    playbackErrorRef.current = playbackError;
  }, [playbackError]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    roomSlugRef.current = roomSlug ?? null;
  }, [roomSlug, snapshot]);

  useEffect(() => {
    preferredFormatRef.current = detectPreferredListenTogetherAudioFormat();
    playbackRetryKeyRef.current = null;
  }, [currentEntryId, voiceSessionId]);

  useEffect(() => {
    return subscribeDesktopTokenChanges((nextToken) => {
      const normalizedToken = nextToken ?? null;
      setDesktopAuthToken((currentToken) => {
        if (currentToken === normalizedToken) return currentToken;

        log.info(
          "Desktop auth token changed; refreshing listen together media URL",
          {
            roomSlug,
            hasToken: !!normalizedToken,
            voiceSessionId,
          },
        );
        playbackRetryKeyRef.current = null;
        return normalizedToken;
      });
    });
  }, [roomSlug, voiceSessionId]);

  useEffect(() => {
    const musicAudio = new Audio();
    const radioAudio = new Audio();
    const audioProcessor = audioProcessorRef.current;
    if (hasCreatedAudioElementsRef.current) {
      audioElementsReplacedRef.current = true;
    }
    hasCreatedAudioElementsRef.current = true;
    musicAudio.preload = "auto";
    musicAudio.crossOrigin = "anonymous";
    radioAudio.preload = "auto";
    musicAudioRef.current = musicAudio;
    radioAudioRef.current = radioAudio;

    return () => {
      for (const audio of [musicAudio, radioAudio]) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      audioProcessor.close();
      audioProcessorConnectedRef.current = false;
      musicSrcRef.current = null;
      radioSrcRef.current = null;
      musicAudioRef.current = null;
      radioAudioRef.current = null;
    };
  }, [sfu]);

  useEffect(() => {
    const musicAudio = musicAudioRef.current;
    const radioAudio = radioAudioRef.current;
    if (!musicAudio || !radioAudio) return;

    const markProgrammaticMediaEvent = (
      audio: HTMLAudioElement,
      eventType: "play" | "pause",
    ) => {
      const events =
        suppressedNativeEventsRef.current.get(audio) ??
        new Set<"play" | "pause">();
      events.add(eventType);
      suppressedNativeEventsRef.current.set(audio, events);
    };

    const consumeProgrammaticMediaEvent = (
      audio: HTMLAudioElement,
      eventType: "play" | "pause",
    ) => {
      const events = suppressedNativeEventsRef.current.get(audio);
      if (!events?.has(eventType)) return false;
      events.delete(eventType);
      if (events.size === 0) suppressedNativeEventsRef.current.delete(audio);
      return true;
    };

    const clearPendingNativePause = (audio: HTMLAudioElement) => {
      const pending = pendingNativePauseTimersRef.current.get(audio);
      if (pending) clearTimeout(pending.timer);
      pendingNativePauseTimersRef.current.delete(audio);
      return pending ?? null;
    };

    const getActiveAudio = () =>
      snapshotRef.current?.currentEntry?.track.kind === "radio"
        ? radioAudio
        : musicAudio;

    const broadcastNativePlaybackEvent = (
      audio: HTMLAudioElement,
      eventType: "play" | "pause",
      expectedEntryId?: string,
    ) => {
      if (getActiveAudio() !== audio) return;

      const activeRoomSlug = roomSlugRef.current;
      const activeSnapshot = snapshotRef.current;
      if (!activeRoomSlug || !activeSnapshot?.currentEntry) return;
      if (
        expectedEntryId &&
        activeSnapshot.currentEntry.entryId !== expectedEntryId
      ) {
        return;
      }

      const paused = eventType === "pause";
      if (activeSnapshot.paused === paused) return;

      const positionMs = Math.max(0, Math.round(audio.currentTime * 1000));
      log.info("Native listen together playback changed", {
        roomSlug: activeRoomSlug,
        eventType,
        paused,
        positionMs,
        trackId: getTrackIdentifier(activeSnapshot.currentEntry.track),
      });
      if (!sfu) {
        setLocalPlayback(activeRoomSlug, null);
        return;
      }
      const accepted = sfu.voiceGW.sendAppEvent({
        type: "listen_together.pause",
        room_slug: activeRoomSlug,
        paused,
        entryId: activeSnapshot.currentEntry.entryId,
      });
      if (accepted) {
        setLocalPlayback(activeRoomSlug, {
          paused,
          positionMs,
          entryId: activeSnapshot.currentEntry.entryId,
          snapshotRevision: activeSnapshot.revision,
          source: "native",
          accepted: true,
        });
      } else {
        setLocalPlayback(activeRoomSlug, null);
      }
    };

    const handleNativePlaybackEvent = (
      audio: HTMLAudioElement,
      eventType: "play" | "pause",
    ) => {
      if (consumeProgrammaticMediaEvent(audio, eventType)) return;
      const pendingPause = clearPendingNativePause(audio);

      if (eventType === "play") {
        if (pendingPause) {
          clearLocalPlaybackIfMatches(
            pendingPause.roomSlug,
            pendingPause.playback,
          );
        }
        broadcastNativePlaybackEvent(audio, eventType);
        return;
      }

      if (audio.ended) return;
      if (getActiveAudio() !== audio) return;
      const activeRoomSlug = roomSlugRef.current;
      const activeSnapshot = snapshotRef.current;
      if (
        !activeRoomSlug ||
        !activeSnapshot?.currentEntry ||
        activeSnapshot.paused
      ) {
        return;
      }
      const entryId = activeSnapshot.currentEntry.entryId;
      const positionMs = Math.max(0, Math.round(audio.currentTime * 1000));
      const pendingPlayback: ListenTogetherLocalPlayback = {
        paused: true,
        positionMs,
        entryId,
        snapshotRevision: activeSnapshot.revision,
        source: "native",
        accepted: false,
      };
      setLocalPlayback(activeRoomSlug, pendingPlayback);
      const timer = setTimeout(() => {
        pendingNativePauseTimersRef.current.delete(audio);
        const latestSnapshot = snapshotRef.current;
        if (
          audio.ended ||
          !audio.paused ||
          roomSlugRef.current !== activeRoomSlug ||
          getActiveAudio() !== audio ||
          latestSnapshot?.currentEntry?.entryId !== entryId
        ) {
          clearLocalPlaybackIfMatches(activeRoomSlug, pendingPlayback);
          return;
        }
        broadcastNativePlaybackEvent(audio, eventType, entryId);
      }, 50);
      pendingNativePauseTimersRef.current.set(audio, {
        timer,
        playback: pendingPlayback,
        roomSlug: activeRoomSlug,
      });
    };

    const addAudioListeners = (
      audio: HTMLAudioElement,
      currentSrcRef: React.MutableRefObject<string | null>,
    ) => {
      const handleCanPlay = () => {
        if (getActiveAudio() !== audio) return;
        const activeRoomSlug = roomSlugRef.current;
        if (!activeRoomSlug) return;
        if (!playbackErrorRef.current?.code.startsWith("PLAYBACK_")) return;
        playbackRetryKeyRef.current = null;
        log.info("Listen together audio can play", {
          roomSlug: activeRoomSlug,
          src: redactListenTogetherStreamUrl(
            audio.src || currentSrcRef.current,
          ),
        });
        clearPlaybackError(activeRoomSlug);
      };

      const handleError = () => {
        if (getActiveAudio() !== audio) return;
        const activeRoomSlug = roomSlugRef.current;
        const activeSnapshot = snapshotRef.current;
        const activeEntry = activeSnapshot?.currentEntry ?? null;
        if (!activeRoomSlug || !activeEntry) return;

        log.warn("Listen together audio element error", {
          roomSlug: activeRoomSlug,
          trackId: getTrackIdentifier(activeEntry.track),
          mediaErrorCode: audio.error?.code ?? null,
          preferredFormat: preferredFormatRef.current,
          currentTimeMs: Math.round(audio.currentTime * 1000),
          readyState: audio.readyState,
          networkState: audio.networkState,
          src: redactListenTogetherStreamUrl(
            audio.src || currentSrcRef.current,
          ),
        });
        playbackGenerationRef.current += 1;

        const retryKey = `${activeRoomSlug}:${activeEntry.entryId}:${getTrackIdentifier(activeEntry.track)}`;
        if (playbackRetryKeyRef.current !== retryKey) {
          playbackRetryKeyRef.current = retryKey;
          preferredFormatRef.current =
            preferredFormatRef.current === "mp4" ? "webm" : "mp4";
          currentSrcRef.current = null;
          if (!audio.paused) markProgrammaticMediaEvent(audio, "pause");
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          setError(activeRoomSlug, {
            code: "PLAYBACK_RETRYING",
            message: "Retrying playback with an alternate audio format.",
          });
          setSourceAttempt((value) => value + 1);
          return;
        }

        const mediaErrorCode = audio.error?.code ?? null;
        const code =
          mediaErrorCode === 4
            ? "PLAYBACK_SRC_NOT_SUPPORTED"
            : "PLAYBACK_FAILED";
        setError(activeRoomSlug, {
          code,
          message:
            "Playback failed after trying multiple supported audio formats.",
        });
      };

      const handleLoadStart = () => {
        const activeRoomSlug = roomSlugRef.current;
        if (!activeRoomSlug) return;
        log.info("Listen together audio load started", {
          roomSlug: activeRoomSlug,
          currentTimeMs: Math.round(audio.currentTime * 1000),
          src: redactListenTogetherStreamUrl(
            audio.src || currentSrcRef.current,
          ),
        });
      };

      const handleWaiting = () => {
        if (getActiveAudio() !== audio) return;
        const activeRoomSlug = roomSlugRef.current;
        if (!activeRoomSlug) return;
        log.info("Listen together audio waiting for more data", {
          roomSlug: activeRoomSlug,
          currentTimeMs: Math.round(audio.currentTime * 1000),
          readyState: audio.readyState,
          networkState: audio.networkState,
          src: redactListenTogetherStreamUrl(
            audio.src || currentSrcRef.current,
          ),
        });
      };

      const handleStalled = () => {
        if (getActiveAudio() !== audio) return;
        const activeRoomSlug = roomSlugRef.current;
        if (!activeRoomSlug) return;
        log.warn("Listen together audio stalled", {
          roomSlug: activeRoomSlug,
          currentTimeMs: Math.round(audio.currentTime * 1000),
          readyState: audio.readyState,
          networkState: audio.networkState,
          src: redactListenTogetherStreamUrl(
            audio.src || currentSrcRef.current,
          ),
        });
      };

      const handleEnded = () => {
        const pendingPause = clearPendingNativePause(audio);
        const activeRoomSlug = roomSlugRef.current;
        const activeSnapshot = snapshotRef.current;
        if (pendingPause) {
          clearLocalPlaybackIfMatches(
            pendingPause.roomSlug,
            pendingPause.playback,
          );
        }
        if (
          !activeRoomSlug ||
          !activeSnapshot?.currentEntry ||
          getActiveAudio() !== audio
        ) {
          return;
        }
        log.info("Listen together track ended locally", {
          roomSlug: activeRoomSlug,
          positionMs: Math.max(0, Math.round(audio.currentTime * 1000)),
          durationMs: activeSnapshot.durationMs,
          trackId: getTrackIdentifier(activeSnapshot.currentEntry.track),
        });
      };

      audio.addEventListener("canplay", handleCanPlay);
      audio.addEventListener("error", handleError);
      audio.addEventListener("loadstart", handleLoadStart);
      audio.addEventListener("waiting", handleWaiting);
      audio.addEventListener("stalled", handleStalled);
      audio.addEventListener("ended", handleEnded);
      const handlePlay = () => handleNativePlaybackEvent(audio, "play");
      const handlePause = () => handleNativePlaybackEvent(audio, "pause");
      audio.addEventListener("play", handlePlay);
      audio.addEventListener("pause", handlePause);

      return () => {
        audio.removeEventListener("canplay", handleCanPlay);
        audio.removeEventListener("error", handleError);
        audio.removeEventListener("loadstart", handleLoadStart);
        audio.removeEventListener("waiting", handleWaiting);
        audio.removeEventListener("stalled", handleStalled);
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("pause", handlePause);
        const pending = clearPendingNativePause(audio);
        if (pending) {
          clearLocalPlaybackIfMatches(pending.roomSlug, pending.playback);
        }
      };
    };

    const removeMusicListeners = addAudioListeners(musicAudio, musicSrcRef);
    const removeRadioListeners = addAudioListeners(radioAudio, radioSrcRef);

    const mediaSession =
      typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    const mediaSessionActions: MediaSessionAction[] = ["play", "pause"];
    if (mediaSession) {
      for (const action of mediaSessionActions) {
        try {
          mediaSession.setActionHandler(action, () => {
            const activeAudio = getActiveAudio();
            if (!snapshotRef.current?.currentEntry) return;
            if (action === "pause") {
              activeAudio.pause();
              return;
            }
            void activeAudio.play().catch(() => {});
          });
        } catch {
          // Some browsers expose MediaSession but do not support every action.
        }
      }
    }

    return () => {
      removeMusicListeners();
      removeRadioListeners();
      if (mediaSession) {
        for (const action of mediaSessionActions) {
          try {
            mediaSession.setActionHandler(action, null);
          } catch {
            // Ignore unsupported MediaSession actions during cleanup.
          }
        }
      }
    };
  }, [
    clearLocalPlaybackIfMatches,
    clearPlaybackError,
    roomSlug,
    setError,
    setLocalPlayback,
    sfu,
  ]);

  useEffect(() => {
    if (!roomSlug) return;
    ensureRoom(roomSlug);
    return () => {
      for (const audio of [musicAudioRef.current, radioAudioRef.current]) {
        if (!audio) continue;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      musicSrcRef.current = null;
      radioSrcRef.current = null;
      clearRoom(roomSlug);
    };
  }, [clearRoom, ensureRoom, roomSlug]);

  useEffect(() => {
    const musicAudio = musicAudioRef.current;
    const radioAudio = radioAudioRef.current;
    if (!musicAudio || !radioAudio) return;
    if (audioProcessorConnectedRef.current) {
      audioProcessorRef.current.setVolume(localVolume);
    } else {
      musicAudio.volume = localVolume;
    }
    radioAudio.volume = localVolume;
  }, [audioContextRevision, localVolume, sfu]);

  useEffect(() => {
    const audio = musicAudioRef.current;
    if (
      !audio ||
      !sfu ||
      !loudnessEnabled ||
      snapshot?.currentEntry?.track.kind !== "music"
    )
      return;
    if (typeof AudioContext === "undefined") return;
    const audioProcessor = audioProcessorRef.current;
    const context = sfu.audio?.getAudioContext?.();
    if (!context) return;
    if (
      audioProcessorConnectedRef.current &&
      !audioProcessor.isConnectedTo(context)
    ) {
      audioProcessor.close();
      audioProcessorConnectedRef.current = false;
    }
    sfu.resumeAudioContext?.();
    if (!audioProcessor.connect(audio, context)) return;
    audioProcessorConnectedRef.current = true;
    audio.volume = 1;
    audioProcessor.setVolume(localVolume);
    audioProcessor.applySettings({
      enabled: loudnessEnabled,
      preset: loudnessPreset,
    });
  }, [
    localVolume,
    loudnessEnabled,
    loudnessPreset,
    sfu,
    snapshot?.currentEntry?.track.kind,
    audioContextRevision,
  ]);

  useEffect(() => {
    if (!audioProcessorConnectedRef.current) return;
    audioProcessorRef.current.applySettings({
      enabled: loudnessEnabled,
      preset: loudnessPreset,
    });
  }, [loudnessEnabled, loudnessPreset]);

  useEffect(() => {
    if (!sfu || !roomSlug) return;

    const unsubscribe = sfu.on("app-event", (rawEvent) => {
      if (!rawEvent || typeof rawEvent !== "object") return;
      const event = rawEvent as Record<string, unknown>;
      if (!isListenTogetherEvent(event)) return;
      if (event.room_slug !== roomSlug) return;

      if (
        (event.type === "listen_together.snapshot" ||
          event.type === "listen_together.queue.updated" ||
          event.type === "listen_together.playback.updated") &&
        event.snapshot
      ) {
        if (
          !isListenTogetherSnapshot(event.snapshot) ||
          event.snapshot.roomSlug !== roomSlug
        ) {
          log.warn("Ignoring malformed listen together snapshot", {
            roomSlug,
            eventType: event.type,
          });
          return;
        }
        const wasAwaitingAuthoritativeSnapshot =
          awaitingAuthoritativeSnapshotRef.current;
        awaitingAuthoritativeSnapshotRef.current = false;
        if (authorityRetryTimerRef.current) {
          clearTimeout(authorityRetryTimerRef.current);
          authorityRetryTimerRef.current = null;
        }
        if (wasAwaitingAuthoritativeSnapshot) {
          setPlaybackSyncEpoch((epoch) => epoch + 1);
        }
        const nextSnapshot = event.snapshot;
        const previousSnapshot = snapshotRef.current;
        if (
          !previousSnapshot ||
          previousSnapshot.paused !== nextSnapshot.paused ||
          previousSnapshot.currentEntryId !== nextSnapshot.currentEntryId
        ) {
          log.info("Applying authoritative listen together state", {
            roomSlug,
            eventType: event.type,
            revision: nextSnapshot.revision,
            currentEntryId: nextSnapshot.currentEntryId,
            paused: nextSnapshot.paused,
            previousPaused: previousSnapshot?.paused ?? null,
            previousEntryId: previousSnapshot?.currentEntryId ?? null,
          });
        }
        log.debug("Received listen together snapshot event", {
          roomSlug,
          eventType: event.type,
          revision: nextSnapshot.revision,
          currentEntryId: nextSnapshot.currentEntryId,
          paused: nextSnapshot.paused,
          positionMs: nextSnapshot.positionMs,
        });
        setSnapshot(roomSlug, nextSnapshot);
        return;
      }

      if (event.type === "listen_together.error") {
        log.warn("Received listen together room error", {
          roomSlug,
          code: typeof event.code === "string" ? event.code : "UNKNOWN",
          message:
            typeof event.message === "string"
              ? event.message
              : "Listen Together error",
        });
        setError(roomSlug, {
          code: typeof event.code === "string" ? event.code : "UNKNOWN",
          message:
            typeof event.message === "string"
              ? event.message
              : "Listen Together error",
        });
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [roomSlug, setError, setSnapshot, sfu]);

  useEffect(() => {
    if (!sfu || !roomSlug || !voiceSessionId) return;
    if (sfu.voiceGW.isReady === false) return;
    log.info("Requesting listen together room state", {
      roomSlug,
      voiceSessionId,
    });
    sfu.voiceGW.sendAppEvent({
      type: "listen_together.state.request",
      room_slug: roomSlug,
    });
  }, [roomSlug, sfu, voiceSessionId]);

  useEffect(() => {
    if (!sfu || !roomSlug || !voiceSessionId) return;

    const unsubscribe = sfu.on("voice-ready", () => {
      sfu.resumeAudioContext?.();
      awaitingAuthoritativeSnapshotRef.current = true;
      if (authorityRetryTimerRef.current) {
        clearTimeout(authorityRetryTimerRef.current);
      }
      let retryCount = 0;
      const requestAuthoritativeState = () => {
        sfu.voiceGW.sendAppEvent({
          type: "listen_together.state.request",
          room_slug: roomSlug,
        });
        if (retryCount < 2 && awaitingAuthoritativeSnapshotRef.current) {
          retryCount += 1;
          authorityRetryTimerRef.current = setTimeout(
            requestAuthoritativeState,
            1_000,
          );
        } else {
          authorityRetryTimerRef.current = setTimeout(() => {
            authorityRetryTimerRef.current = null;
            if (!awaitingAuthoritativeSnapshotRef.current) return;
            awaitingAuthoritativeSnapshotRef.current = false;
            setPlaybackSyncEpoch((epoch) => epoch + 1);
            setError(roomSlug, {
              code: "SYNC_TIMEOUT",
              message:
                "Could not refresh Listen Together state; continuing with the last known state.",
            });
          }, 1_000);
        }
      };
      for (const [audio, pending] of pendingNativePauseTimersRef.current) {
        clearTimeout(pending.timer);
        clearLocalPlaybackIfMatches(pending.roomSlug, pending.playback);
        pendingNativePauseTimersRef.current.delete(audio);
      }
      for (const audio of [musicAudioRef.current, radioAudioRef.current]) {
        if (!audio || audio.paused) continue;
        suppressedNativeEventsRef.current.set(audio, new Set(["pause"]));
        audio.pause();
      }
      setLocalPlayback(roomSlug, null);
      log.info("Voice gateway ready; requesting listen together room state", {
        roomSlug,
        voiceSessionId,
      });
      requestAuthoritativeState();
    });
    const unsubscribeAudioResumed = sfu.on("audio-resumed", () => {
      setAudioContextRevision((revision) => revision + 1);
    });

    return () => {
      unsubscribe();
      unsubscribeAudioResumed();
      if (authorityRetryTimerRef.current) {
        clearTimeout(authorityRetryTimerRef.current);
        authorityRetryTimerRef.current = null;
      }
      awaitingAuthoritativeSnapshotRef.current = false;
    };
  }, [
    clearLocalPlaybackIfMatches,
    roomSlug,
    setError,
    setLocalPlayback,
    sfu,
    voiceSessionId,
  ]);

  useEffect(() => {
    const trackKind = snapshot?.currentEntry?.track.kind;
    const audio =
      trackKind === "radio" ? radioAudioRef.current : musicAudioRef.current;
    const inactiveAudio =
      trackKind === "radio" ? musicAudioRef.current : radioAudioRef.current;
    const currentSrcRef = trackKind === "radio" ? radioSrcRef : musicSrcRef;
    if (!audio || !roomSlug || awaitingAuthoritativeSnapshotRef.current) return;

    const currentEntry = snapshot?.currentEntry;
    inactiveAudio?.pause();

    const streamUrl =
      currentEntry?.track.kind === "music" && voiceSessionId
        ? buildListenTogetherStreamUrl({
            videoId: currentEntry.track.videoId,
            roomSlug,
            voiceSessionId,
            serverId,
            channelId,
            preferredFormat: preferredFormatRef.current,
          })
        : currentEntry?.track.kind === "radio"
          ? currentEntry.track.streamUrl
          : null;

    log.debug("Evaluating listen together playback state", {
      roomSlug,
      trackId: snapshot?.currentEntry?.track
        ? getTrackIdentifier(snapshot.currentEntry.track)
        : null,
      voiceSessionId,
      hasDesktopAuthToken: !!desktopAuthToken,
      preferredFormat: preferredFormatRef.current,
      streamUrl: redactListenTogetherStreamUrl(streamUrl),
      currentSrc: redactListenTogetherStreamUrl(currentSrcRef.current),
      paused: snapshot?.paused ?? null,
    });

    const authoritativeSnapshot = snapshot
      ? {
          ...snapshot,
          positionMs:
            audioContextRevision > 0 || audioElementsReplacedRef.current
              ? getListenTogetherPositionMs(
                  snapshot,
                  snapshot.durationMs,
                  Date.now(),
                )
              : snapshot.positionMs,
        }
      : null;
    audioElementsReplacedRef.current = false;
    const plan = getListenTogetherPlaybackPlan({
      snapshot: authoritativeSnapshot,
      playback: {
        src: currentSrcRef.current,
        currentTimeMs: Math.max(0, audio.currentTime * 1000),
        paused: audio.paused,
      },
      nativePaused: localPlayback?.paused,
      streamUrl,
    });
    const playbackGenerationKey = `${roomSlug}:${currentEntry?.entryId ?? ""}:${plan.nextSrc ?? ""}`;
    if (playbackGenerationKeyRef.current !== playbackGenerationKey) {
      playbackGenerationKeyRef.current = playbackGenerationKey;
      playbackGenerationRef.current += 1;
    }

    if (plan.nextSrc === null) {
      if (currentSrcRef.current || !audio.paused) {
        if (!audio.paused) {
          suppressedNativeEventsRef.current.set(audio, new Set(["pause"]));
        }
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        currentSrcRef.current = null;
      }
      return;
    }

    if (plan.shouldLoad && plan.nextSrc) {
      if (!audio.paused) {
        suppressedNativeEventsRef.current.set(audio, new Set(["pause"]));
        audio.pause();
      }
      currentSrcRef.current = plan.nextSrc;
      audio.src = plan.nextSrc;
      audio.load();
      log.info("Loaded listen together stream source", {
        roomSlug,
        streamUrl: redactListenTogetherStreamUrl(plan.nextSrc),
      });
    }

    if (plan.seekToMs !== null) {
      audio.currentTime = Math.max(0, plan.seekToMs / 1000);
      log.debug("Synchronized listen together playback position", {
        roomSlug,
        seekToMs: plan.seekToMs,
      });
    }

    if (plan.shouldPause) {
      audio.pause();
      log.info("Paused listen together audio to match room state", {
        roomSlug,
      });
      return;
    }

    if (plan.shouldPlay && audio.paused && localPlayback?.paused !== true) {
      sfu?.resumeAudioContext?.();
      const playGeneration = playbackGenerationRef.current;
      const playEntryId = currentEntry?.entryId ?? null;
      const playSource = currentSrcRef.current;
      log.info("Starting listen together audio", {
        roomSlug,
        trackId: currentEntry ? getTrackIdentifier(currentEntry.track) : null,
        snapshotPaused: snapshot?.paused ?? null,
        audioPaused: audio.paused,
        audioMuted: audio.muted,
        audioVolume: audio.volume,
        audioContextState: sfu?.audio?.getAudioContext?.()?.state ?? null,
      });
      void audio.play().catch((error) => {
        const isStalePlay =
          playGeneration !== playbackGenerationRef.current ||
          (snapshotRef.current?.currentEntry?.track.kind === "radio"
            ? radioAudioRef.current
            : musicAudioRef.current) !== audio ||
          roomSlugRef.current !== roomSlug ||
          snapshotRef.current?.currentEntry?.entryId !== playEntryId ||
          currentSrcRef.current !== playSource;
        if (isStalePlay) {
          log.debug("Ignoring stale listen together playback rejection", {
            roomSlug,
            playEntryId,
            currentEntryId: snapshotRef.current?.currentEntry?.entryId ?? null,
          });
          return;
        }
        if (
          isExpectedListenTogetherPlayCancellation(
            error,
            snapshotRef.current?.paused === true,
          )
        ) {
          log.debug(
            "Listen together playback start cancelled by authoritative pause",
            { roomSlug },
          );
          return;
        }
        log.warn("Listen together playback start was blocked", {
          roomSlug,
          message: error instanceof Error ? error.message : String(error),
          streamUrl: redactListenTogetherStreamUrl(
            audio.src || currentSrcRef.current,
          ),
        });
        setError(roomSlug, {
          code: "PLAYBACK_BLOCKED",
          message:
            error instanceof Error
              ? error.message
              : "Playback could not start locally",
        });
      });
    }
  }, [
    channelId,
    clearLocalPlaybackIfMatches,
    desktopAuthToken,
    roomSlug,
    serverId,
    setError,
    sfu,
    snapshot,
    sourceAttempt,
    voiceSessionId,
    localPlayback?.paused,
    audioContextRevision,
    playbackSyncEpoch,
  ]);

  return null;
}
