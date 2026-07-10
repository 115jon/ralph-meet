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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioProcessorRef = useRef(new ListenTogetherAudioProcessor());
  const audioProcessorConnectedRef = useRef(false);
  const currentSrcRef = useRef<string | null>(null);
  const preferredFormatRef = useRef(detectPreferredListenTogetherAudioFormat());
  const playbackRetryKeyRef = useRef<string | null>(null);
  const snapshotRef = useRef<ListenTogetherStateSnapshot | null>(null);
  const roomSlugRef = useRef<string | null>(roomSlug ?? null);
  const [sourceAttempt, setSourceAttempt] = useState(0);
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
  }, [snapshot?.currentEntry?.track.videoId, voiceSessionId]);

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
    const audio = new Audio();
    const audioProcessor = audioProcessorRef.current;
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioProcessor.close();
      audioProcessorConnectedRef.current = false;
      currentSrcRef.current = null;
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleCanPlay = () => {
      const activeRoomSlug = roomSlugRef.current;
      if (!activeRoomSlug) return;
      log.info("Listen together audio can play", {
        roomSlug: activeRoomSlug,
        src: redactListenTogetherStreamUrl(audio.src || currentSrcRef.current),
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
        videoId: activeEntry.track.videoId,
        mediaErrorCode: audio.error?.code ?? null,
        preferredFormat: preferredFormatRef.current,
        currentTimeMs: Math.round(audio.currentTime * 1000),
        readyState: audio.readyState,
        networkState: audio.networkState,
        src: redactListenTogetherStreamUrl(audio.src || currentSrcRef.current),
      });

      const retryKey = `${activeRoomSlug}:${activeEntry.track.videoId}`;
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
        mediaErrorCode === 4 ? "PLAYBACK_SRC_NOT_SUPPORTED" : "PLAYBACK_FAILED";
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
        src: redactListenTogetherStreamUrl(audio.src || currentSrcRef.current),
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
        src: redactListenTogetherStreamUrl(audio.src || currentSrcRef.current),
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
        src: redactListenTogetherStreamUrl(audio.src || currentSrcRef.current),
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
  }, [setError]);

  useEffect(() => {
    if (!roomSlug) return;
    ensureRoom(roomSlug);
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      currentSrcRef.current = null;
      clearRoom(roomSlug);
    };
  }, [clearRoom, ensureRoom, roomSlug]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioProcessorConnectedRef.current) {
      audioProcessorRef.current.setVolume(localVolume);
      return;
    }
    audio.volume = localVolume;
  }, [localVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (
      !audio ||
      !sfu ||
      !loudnessEnabled ||
      audioProcessorConnectedRef.current
    )
      return;
    if (typeof AudioContext === "undefined") return;
    const audioProcessor = audioProcessorRef.current;
    sfu.resumeAudioContext?.();
    if (!audioProcessor.connect(audio, sfu.audio.getAudioContext())) return;
    audioProcessorConnectedRef.current = true;
    audio.volume = 1;
    audioProcessor.setVolume(localVolume);
    audioProcessor.applySettings({
      enabled: loudnessEnabled,
      preset: loudnessPreset,
    });
  }, [localVolume, loudnessEnabled, loudnessPreset, sfu]);

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
    const audio = audioRef.current;
    if (!audio || !roomSlug) return;

    const streamUrl =
      snapshot?.currentEntry && voiceSessionId
        ? buildListenTogetherStreamUrl({
            videoId: snapshot.currentEntry.track.videoId,
            roomSlug,
            voiceSessionId,
            serverId,
            channelId,
            preferredFormat: preferredFormatRef.current,
          })
        : null;

    log.debug("Evaluating listen together playback state", {
      roomSlug,
      videoId: snapshot?.currentEntry?.track.videoId ?? null,
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
