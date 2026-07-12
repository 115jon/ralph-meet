import { clog } from "@/lib/console-logger";
import {
  getDesktopAuthHandoffToken,
  subscribeDesktopTokenChanges,
} from "@/lib/desktop-auth";
import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import type { SFUClient } from "@/lib/sfu-client";
import {
  buildListenTogetherStreamUrl,
  detectPreferredListenTogetherAudioFormat,
  getListenTogetherPlaybackPlan,
} from "@/lib/voice/listen-together-player";
import { ListenTogetherAudioProcessor } from "@/lib/voice/listen-together-audio";
import { useListenTogetherAudioSettingsStore } from "@/stores/useListenTogetherAudioSettingsStore";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
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
  const currentTrackId = snapshot?.currentEntry?.track
    ? getTrackIdentifier(snapshot.currentEntry.track)
    : null;
  const localVolume = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.localVolume ?? 1) : 1,
  );
  const loudnessEnabled = useListenTogetherAudioSettingsStore(
    (state) => state.enabled,
  );
  const loudnessPreset = useListenTogetherAudioSettingsStore(
    (state) => state.preset,
  );
  const ensureRoom = useListenTogetherStore((state) => state.ensureRoom);
  const setSnapshot = useListenTogetherStore((state) => state.setSnapshot);
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
  const snapshotRef = useRef<ListenTogetherStateSnapshot | null>(null);
  const roomSlugRef = useRef<string | null>(roomSlug ?? null);
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [audioContextRevision, setAudioContextRevision] = useState(0);
  const [desktopAuthToken, setDesktopAuthToken] = useState<string | null>(() =>
    getDesktopAuthHandoffToken(),
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
    roomSlugRef.current = roomSlug ?? null;
  }, [roomSlug, snapshot]);

  useEffect(() => {
    preferredFormatRef.current = detectPreferredListenTogetherAudioFormat();
    playbackRetryKeyRef.current = null;
  }, [currentTrackId, voiceSessionId]);

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
  }, []);

  useEffect(() => {
    const musicAudio = musicAudioRef.current;
    const radioAudio = radioAudioRef.current;
    if (!musicAudio || !radioAudio) return;

    const addAudioListeners = (
      audio: HTMLAudioElement,
      currentSrcRef: React.MutableRefObject<string | null>,
    ) => {
      const handleCanPlay = () => {
        const activeRoomSlug = roomSlugRef.current;
        if (!activeRoomSlug) return;
        log.info("Listen together audio can play", {
          roomSlug: activeRoomSlug,
          src: redactListenTogetherStreamUrl(
            audio.src || currentSrcRef.current,
          ),
        });
        setError(activeRoomSlug, null);
      };

      const handleError = () => {
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

        const retryKey = `${activeRoomSlug}:${getTrackIdentifier(activeEntry.track)}`;
        if (playbackRetryKeyRef.current !== retryKey) {
          playbackRetryKeyRef.current = retryKey;
          preferredFormatRef.current =
            preferredFormatRef.current === "mp4" ? "webm" : "mp4";
          currentSrcRef.current = null;
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

      audio.addEventListener("canplay", handleCanPlay);
      audio.addEventListener("error", handleError);
      audio.addEventListener("loadstart", handleLoadStart);
      audio.addEventListener("waiting", handleWaiting);
      audio.addEventListener("stalled", handleStalled);

      return () => {
        audio.removeEventListener("canplay", handleCanPlay);
        audio.removeEventListener("error", handleError);
        audio.removeEventListener("loadstart", handleLoadStart);
        audio.removeEventListener("waiting", handleWaiting);
        audio.removeEventListener("stalled", handleStalled);
      };
    };

    const removeMusicListeners = addAudioListeners(musicAudio, musicSrcRef);
    const removeRadioListeners = addAudioListeners(radioAudio, radioSrcRef);
    return () => {
      removeMusicListeners();
      removeRadioListeners();
    };
  }, [setError]);

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
  }, [localVolume]);

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
      const event = rawEvent as Record<string, unknown>;
      if (!isListenTogetherEvent(event)) return;
      if (event.room_slug !== roomSlug) return;

      if (
        (event.type === "listen_together.snapshot" ||
          event.type === "listen_together.queue.updated" ||
          event.type === "listen_together.playback.updated") &&
        event.snapshot
      ) {
        const nextSnapshot = event.snapshot as ListenTogetherStateSnapshot;
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
      setAudioContextRevision((revision) => revision + 1);
      log.info("Voice gateway ready; requesting listen together room state", {
        roomSlug,
        voiceSessionId,
      });
      sfu.voiceGW.sendAppEvent({
        type: "listen_together.state.request",
        room_slug: roomSlug,
      });
    });
    const unsubscribeAudioResumed = sfu.on("audio-resumed", () => {
      setAudioContextRevision((revision) => revision + 1);
    });

    return () => {
      unsubscribe();
      unsubscribeAudioResumed();
    };
  }, [roomSlug, sfu, voiceSessionId]);

  useEffect(() => {
    const trackKind = snapshot?.currentEntry?.track.kind;
    const audio =
      trackKind === "radio" ? radioAudioRef.current : musicAudioRef.current;
    const inactiveAudio =
      trackKind === "radio" ? musicAudioRef.current : radioAudioRef.current;
    const currentSrcRef = trackKind === "radio" ? radioSrcRef : musicSrcRef;
    if (!audio || !roomSlug) return;

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

    const plan = getListenTogetherPlaybackPlan({
      snapshot,
      playback: {
        src: currentSrcRef.current,
        currentTimeMs: Math.max(0, audio.currentTime * 1000),
        paused: audio.paused,
      },
      streamUrl,
    });

    if (plan.nextSrc === null) {
      if (currentSrcRef.current || !audio.paused) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        currentSrcRef.current = null;
      }
      return;
    }

    if (plan.shouldLoad && plan.nextSrc) {
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

    if (plan.shouldPlay) {
      sfu?.resumeAudioContext?.();
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
    desktopAuthToken,
    roomSlug,
    serverId,
    setError,
    sfu,
    snapshot,
    sourceAttempt,
    voiceSessionId,
  ]);

  return null;
}
