import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import type { SFUClient } from "@/lib/sfu-client";
import {
  buildListenTogetherStreamUrl,
  detectPreferredListenTogetherAudioFormat,
  getListenTogetherPlaybackPlan,
} from "@/lib/voice/listen-together-player";
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
  return typeof event.type === "string" && event.type.startsWith("listen_together.");
}

export function VoiceListenTogetherManager({
  sfu,
  roomSlug,
  voiceSessionId,
  serverId,
  channelId,
}: VoiceListenTogetherManagerProps) {
  const snapshot = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.snapshot ?? null : null,
  );
  const localVolume = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.localVolume ?? 1 : 1,
  );
  const ensureRoom = useListenTogetherStore((state) => state.ensureRoom);
  const setSnapshot = useListenTogetherStore((state) => state.setSnapshot);
  const setError = useListenTogetherStore((state) => state.setError);
  const clearRoom = useListenTogetherStore((state) => state.clearRoom);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSrcRef = useRef<string | null>(null);
  const preferredFormatRef = useRef(detectPreferredListenTogetherAudioFormat());
  const playbackRetryKeyRef = useRef<string | null>(null);
  const snapshotRef = useRef<ListenTogetherStateSnapshot | null>(null);
  const roomSlugRef = useRef<string | null>(roomSlug ?? null);
  const [sourceAttempt, setSourceAttempt] = useState(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
    roomSlugRef.current = roomSlug ?? null;
  }, [roomSlug, snapshot]);

  useEffect(() => {
    preferredFormatRef.current = detectPreferredListenTogetherAudioFormat();
    playbackRetryKeyRef.current = null;
    setSourceAttempt(0);
  }, [snapshot?.currentEntry?.track.videoId]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = localVolume;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
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
      setError(activeRoomSlug, null);
    };

    const handleError = () => {
      const activeRoomSlug = roomSlugRef.current;
      const activeSnapshot = snapshotRef.current;
      const activeEntry = activeSnapshot?.currentEntry ?? null;
      if (!activeRoomSlug || !activeEntry) return;

      const retryKey = `${activeRoomSlug}:${activeEntry.track.videoId}`;
      if (playbackRetryKeyRef.current !== retryKey) {
        playbackRetryKeyRef.current = retryKey;
        preferredFormatRef.current = preferredFormatRef.current === "mp4" ? "webm" : "mp4";
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
      const code = mediaErrorCode === 4 ? "PLAYBACK_SRC_NOT_SUPPORTED" : "PLAYBACK_FAILED";
      setError(activeRoomSlug, {
        code,
        message: "Playback failed after trying multiple supported audio formats.",
      });
    };

    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
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
    if (audioRef.current) {
      audioRef.current.volume = localVolume;
    }
  }, [localVolume]);

  useEffect(() => {
    if (!sfu || !roomSlug) return;

    const unsubscribe = sfu.on("app-event", (rawEvent) => {
      const event = rawEvent as Record<string, unknown>;
      if (!isListenTogetherEvent(event)) return;
      if (event.room_slug !== roomSlug) return;

      if (
        (event.type === "listen_together.snapshot"
          || event.type === "listen_together.queue.updated"
          || event.type === "listen_together.playback.updated")
        && event.snapshot
      ) {
        setSnapshot(roomSlug, event.snapshot as ListenTogetherStateSnapshot);
        return;
      }

      if (event.type === "listen_together.error") {
        setError(roomSlug, {
          code: typeof event.code === "string" ? event.code : "UNKNOWN",
          message: typeof event.message === "string" ? event.message : "Listen Together error",
        });
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [roomSlug, setError, setSnapshot, sfu]);

  useEffect(() => {
    if (!sfu || !roomSlug || !voiceSessionId) return;
    sfu.voiceGW.sendAppEvent({
      type: "listen_together.state.request",
      room_slug: roomSlug,
    });
  }, [roomSlug, sfu, voiceSessionId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !roomSlug) return;

    const streamUrl = snapshot?.currentEntry && voiceSessionId
      ? buildListenTogetherStreamUrl({
        videoId: snapshot.currentEntry.track.videoId,
        roomSlug,
        voiceSessionId,
        serverId,
        channelId,
        preferredFormat: preferredFormatRef.current,
      })
      : null;

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
    }

    if (plan.seekToMs !== null) {
      audio.currentTime = Math.max(0, plan.seekToMs / 1000);
    }

    if (plan.shouldPause) {
      audio.pause();
      return;
    }

    if (plan.shouldPlay) {
      void audio.play().catch((error) => {
        setError(roomSlug, {
          code: "PLAYBACK_BLOCKED",
          message: error instanceof Error ? error.message : "Playback could not start locally",
        });
      });
    }
  }, [channelId, roomSlug, serverId, setError, snapshot, sourceAttempt, voiceSessionId]);

  return null;
}
