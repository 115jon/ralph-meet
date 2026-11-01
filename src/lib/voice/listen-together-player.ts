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

const AUDIO_FORMAT_MIME_TYPES: Record<
  ListenTogetherPreferredAudioFormat,
  string
> = {
  mp4: 'audio/mp4; codecs="mp4a.40.2"',
  webm: 'audio/webm; codecs="opus"',
};

/** `canPlayType` for a format, or null where there is no DOM to ask. */
function canPlayListenTogetherAudioFormat(
  format: ListenTogetherPreferredAudioFormat,
): boolean | null {
  if (typeof document === "undefined") return null;
  const answer = document
    .createElement("audio")
    .canPlayType(AUDIO_FORMAT_MIME_TYPES[format]);
  return answer === "probably" || answer === "maybe";
}

export function detectPreferredListenTogetherAudioFormat(): ListenTogetherPreferredAudioFormat {
  if (canPlayListenTogetherAudioFormat("mp4")) return "mp4";
  if (canPlayListenTogetherAudioFormat("webm")) return "webm";
  return "mp4";
}

export function alternateListenTogetherAudioFormat(
  format: ListenTogetherPreferredAudioFormat,
): ListenTogetherPreferredAudioFormat {
  return format === "mp4" ? "webm" : "mp4";
}

/**
 * Worth switching to `alternate`: unless the platform says it plays the
 * current format and not the alternate one. A platform that answers "" for
 * both (some WebViews, jsdom) is not trusted either way.
 */
export function shouldTryAlternateListenTogetherFormat(
  current: ListenTogetherPreferredAudioFormat,
): boolean {
  const alternate = alternateListenTogetherAudioFormat(current);
  return !(
    canPlayListenTogetherAudioFormat(current) === true &&
    canPlayListenTogetherAudioFormat(alternate) === false
  );
}

/** What the stream route said when asked again; null when it was unreachable. */
export type ListenTogetherStreamProbe = {
  status: number;
  retryAfterSeconds: number | null;
} | null;

/**
 * Ask the stream route what failed. An audio element only reports "error";
 * a HEAD of the same URL (auth rides in the URL) returns the route's status
 * without downloading audio.
 */
export async function probeListenTogetherStream(
  src: string,
): Promise<ListenTogetherStreamProbe> {
  try {
    const response = await fetch(src, {
      method: "HEAD",
      cache: "no-store",
      credentials: "include",
    });
    const retryAfter = Number(response.headers.get("Retry-After"));
    return {
      status: response.status,
      retryAfterSeconds:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    };
  } catch {
    return null;
  }
}

/** Attempts spent on the current track; reset when it plays or changes. */
export interface ListenTogetherRecoveryState {
  transientRetries: number;
  formatSwitched: boolean;
}

export interface ListenTogetherPlaybackRecovery {
  /** retry: same source after `delayMs`; switch-format: the other container now. */
  action: "retry" | "switch-format" | "fail";
  delayMs: number;
  error: { code: string; message: string };
}

export const LISTEN_TOGETHER_MAX_TRANSIENT_RETRIES = 3;
const DEFAULT_BLOCKED_RETRY_SECONDS = 20;
const MAX_RETRY_DELAY_MS = 60_000;
const NETWORK_RETRY_DELAY_MS = 3_000;

const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/**
 * Decide what to do after the audio element failed, from what the stream
 * route says now. Temporary refusals (YouTube's bot wall, 429, a dropped
 * connection) are retried a few times with backoff; a stream the route
 * serves fine but the element cannot decode gets the other container once;
 * everything else is a final, specific error.
 */
export function planListenTogetherPlaybackRecovery(args: {
  mediaErrorCode: number | null;
  probe: ListenTogetherStreamProbe;
  state: ListenTogetherRecoveryState;
  canTryAlternateFormat: boolean;
}): ListenTogetherPlaybackRecovery {
  const { mediaErrorCode, probe, state } = args;
  const retriesLeft =
    state.transientRetries < LISTEN_TOGETHER_MAX_TRANSIENT_RETRIES;
  const switchFormat = (message: string): ListenTogetherPlaybackRecovery => ({
    action: "switch-format",
    delayMs: 0,
    error: { code: "PLAYBACK_RETRYING", message },
  });
  const fail = (code: string, message: string) => ({
    action: "fail" as const,
    delayMs: 0,
    error: { code, message },
  });
  const canSwitch = args.canTryAlternateFormat && !state.formatSwitched;

  if (probe === null) {
    return retriesLeft
      ? {
          action: "retry",
          delayMs: NETWORK_RETRY_DELAY_MS * 2 ** state.transientRetries,
          error: {
            code: "PLAYBACK_RETRYING",
            message: "Lost the audio stream. Reconnecting.",
          },
        }
      : fail(
          "PLAYBACK_FAILED",
          "Couldn't reach the audio stream. Check your connection and try again.",
        );
  }

  if (probe.status === 401 || probe.status === 403) {
    return fail(
      "PLAYBACK_SESSION",
      "Listening needs an active voice connection. Rejoin the channel to keep listening.",
    );
  }

  if (probe.status === 429 || probe.status === 503) {
    if (!retriesLeft) {
      return fail(
        "PLAYBACK_UNAVAILABLE",
        "YouTube is refusing our server right now. Try this track again in a few minutes.",
      );
    }
    const delayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      (probe.retryAfterSeconds ?? DEFAULT_BLOCKED_RETRY_SECONDS) *
        1000 *
        2 ** state.transientRetries,
    );
    return {
      action: "retry",
      delayMs,
      error: {
        code: "PLAYBACK_RETRYING",
        message: `YouTube is refusing our server for a moment. Retrying in ${Math.round(delayMs / 1000)}s.`,
      },
    };
  }

  if (probe.status >= 400) {
    // A 502 is usually per track, but the other container is a separate
    // YouTube URL and costs one request to try.
    return canSwitch
      ? switchFormat("That audio stream failed. Trying another format.")
      : fail(
          "PLAYBACK_UNAVAILABLE",
          "YouTube didn't give us a playable stream for this track. Skip it or queue another version.",
        );
  }

  // The route serves the stream, so the element itself gave up on it.
  if (
    mediaErrorCode === MEDIA_ERR_DECODE ||
    mediaErrorCode === MEDIA_ERR_SRC_NOT_SUPPORTED
  ) {
    return canSwitch
      ? switchFormat("That audio format didn't play here. Trying another one.")
      : fail(
          "PLAYBACK_SRC_NOT_SUPPORTED",
          "This device can't play the audio formats YouTube offers for this track.",
        );
  }

  if (mediaErrorCode === MEDIA_ERR_NETWORK && retriesLeft) {
    return {
      action: "retry",
      delayMs: NETWORK_RETRY_DELAY_MS * 2 ** state.transientRetries,
      error: {
        code: "PLAYBACK_RETRYING",
        message: "Lost the audio stream. Reconnecting.",
      },
    };
  }

  return fail(
    "PLAYBACK_FAILED",
    "Playback stopped and couldn't recover. Skip the track or try again.",
  );
}

export function isExpectedListenTogetherPlayCancellation(
  error: unknown,
  authoritativePaused: boolean,
): boolean {
  if (!authoritativePaused || typeof error !== "object" || error === null) {
    return false;
  }

  return "name" in error && error.name === "AbortError";
}

export function getListenTogetherPlaybackPlan(args: {
  snapshot: ListenTogetherStateSnapshot | null;
  playback: ListenTogetherPlaybackState;
  streamUrl: string | null;
  nativePaused?: boolean;
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

  const isRadio = currentEntry.track.kind === "radio";
  const shouldLoad = args.playback.src !== args.streamUrl;
  const shouldSeek =
    !isRadio &&
    (shouldLoad ||
      Math.abs(args.playback.currentTimeMs - args.snapshot.positionMs) >
        tolerance);

  return {
    nextSrc: args.streamUrl,
    shouldLoad,
    shouldPlay: !args.snapshot.paused && args.nativePaused !== true,
    shouldPause: args.snapshot.paused,
    seekToMs: shouldSeek ? args.snapshot.positionMs : null,
  };
}
