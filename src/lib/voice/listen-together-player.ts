import {
  LISTEN_TOGETHER_DRIFT_TOLERANCE_MS,
  type ListenTogetherStateSnapshot,
} from "@/lib/listen-together";
import { getMediaUrl } from "@/lib/platform";

export interface ListenTogetherPlaybackState {
  src: string | null;
  currentTimeMs: number;
  paused: boolean;
}

export interface ListenTogetherPlaybackPlan {
  nextSrc: string | null;
  shouldLoad: boolean;
  shouldPlay: boolean;
  shouldPause: boolean;
  seekToMs: number | null;
}

export type ListenTogetherPreferredAudioFormat = "mp4" | "webm";

export function buildListenTogetherStreamUrl(args: {
  videoId: string;
  roomSlug: string;
  voiceSessionId: string;
  serverId?: string | null;
  channelId?: string | null;
  preferredFormat?: ListenTogetherPreferredAudioFormat | null;
}): string {
  const params = new URLSearchParams({
    videoId: args.videoId,
    roomSlug: args.roomSlug,
    sessionId: args.voiceSessionId,
  });

  if (args.serverId) params.set("serverId", args.serverId);
  if (args.channelId) params.set("channelId", args.channelId);
  if (args.preferredFormat) params.set("format", args.preferredFormat);
  return getMediaUrl(`/api/listen-together/stream?${params.toString()}`);
}

export function detectPreferredListenTogetherAudioFormat(): ListenTogetherPreferredAudioFormat {
  if (typeof document === "undefined") return "mp4";
  const audio = document.createElement("audio");
  const canPlayMp4 = audio.canPlayType('audio/mp4; codecs="mp4a.40.2"');
  if (canPlayMp4 === "probably" || canPlayMp4 === "maybe") {
    return "mp4";
  }

  const canPlayWebm = audio.canPlayType('audio/webm; codecs="opus"');
  if (canPlayWebm === "probably" || canPlayWebm === "maybe") {
    return "webm";
  }

  return "mp4";
}

export function getListenTogetherPlaybackPlan(args: {
  snapshot: ListenTogetherStateSnapshot | null;
  playback: ListenTogetherPlaybackState;
  streamUrl: string | null;
  driftToleranceMs?: number;
}): ListenTogetherPlaybackPlan {
  const tolerance = args.driftToleranceMs ?? LISTEN_TOGETHER_DRIFT_TOLERANCE_MS;
  const currentEntry = args.snapshot?.currentEntry ?? null;

  if (!args.snapshot || !currentEntry || !args.streamUrl) {
    return {
      nextSrc: null,
      shouldLoad: args.playback.src !== null,
      shouldPlay: false,
      shouldPause: !args.playback.paused || args.playback.src !== null,
      seekToMs: args.playback.currentTimeMs > 0 ? 0 : null,
    };
  }

  const shouldLoad = args.playback.src !== args.streamUrl;
  const shouldSeek =
    shouldLoad
    || Math.abs(args.playback.currentTimeMs - args.snapshot.positionMs) > tolerance;

  return {
    nextSrc: args.streamUrl,
    shouldLoad,
    shouldPlay: !args.snapshot.paused,
    shouldPause: args.snapshot.paused,
    seekToMs: shouldSeek ? args.snapshot.positionMs : null,
  };
}
