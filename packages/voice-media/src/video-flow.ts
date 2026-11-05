/**
 * Whether a pulled camera is actually showing anything, read from the
 * receiver's `framesDecoded`.
 *
 * A pull can produce a track that never decodes a frame (a re-pull the SFU
 * answered on a recycled MID with other RTP header extension IDs, which
 * libwebrtc rejects), or one that stops decoding (the publisher's uplink
 * went, the decoder stalled). Either way the video element shows black or
 * the last frame, frozen. The detector tells those apart from video that
 * plays, so the tile can say so and the media manager can pull it again
 * (see RemoteVideoHealth).
 *
 * Imports nothing, so a tile can load it before the WebRTC runtime (the Expo
 * app's tiles do).
 */

/**
 * waiting: no frame yet, still within the first-frame timeout.
 * playing: frames are being decoded (or nothing can be read: treated as
 * playing, so a platform without stats behaves as before).
 * stalled: no first frame in time, or no new frame for the stall window.
 */
export type VideoFlow = "waiting" | "playing" | "stalled";

/** A `framesDecoded` reading and when it was taken (ms, one clock). */
export interface VideoFrameReading {
  readonly frames: number;
  readonly at: number;
}

export interface VideoFlowOptions {
  /** A new track with no decoded frame after this is stalled. */
  readonly firstFrameTimeoutMs?: number;
  /** A playing track that decodes nothing new for this long is stalled. */
  readonly stallAfterMs?: number;
}

/**
 * A pull usually decodes its first frame within a second or two; the SFU's
 * first keyframe after a layer switch takes up to about two more.
 */
export const VIDEO_FIRST_FRAME_TIMEOUT_MS = 6_000;
/**
 * A re-pull (see RemoteVideoHealth) comes on a new peer connection, whose
 * ICE and DTLS must complete before the first packet: over TURN on a slow
 * uplink that takes several seconds more than a pull on the call's own
 * connection.
 */
export const VIDEO_RECOVERED_FIRST_FRAME_TIMEOUT_MS = 10_000;
/**
 * A camera sends at least a few frames a second, even of a still scene (a
 * keepalive sends one a second). The web reads stats every 2 s, so this is
 * two to three readings without progress.
 */
export const VIDEO_STALL_AFTER_MS = 5_000;

/** Follows one remote video track from the moment it is shown. */
export class VideoFlowDetector {
  private readonly firstFrameTimeoutMs: number;
  private readonly stallAfterMs: number;
  /** The last frame count, and when it was last seen to grow. */
  private frames: number | null = null;
  private progressAt: number;
  private played = false;
  private current: VideoFlow = "waiting";

  constructor(
    private readonly startedAt: number,
    options: VideoFlowOptions = {},
  ) {
    this.firstFrameTimeoutMs =
      options.firstFrameTimeoutMs ?? VIDEO_FIRST_FRAME_TIMEOUT_MS;
    this.stallAfterMs = options.stallAfterMs ?? VIDEO_STALL_AFTER_MS;
    this.progressAt = startedAt;
  }

  get flow(): VideoFlow {
    return this.current;
  }

  /**
   * Takes a reading; null means the stats could not be read. Readings are
   * compared by their own timestamps, so a stats source that stops (a
   * throttled timer) never looks like a stall.
   */
  sample(reading: VideoFrameReading | null): VideoFlow {
    if (!reading) {
      // Nothing to measure: behave as before this existed.
      this.current = "playing";
      return this.current;
    }
    const grew = this.frames !== null && reading.frames > this.frames;
    // The first reading: frames already decoded count as progress.
    const first = this.frames === null && reading.frames > 0;
    if (
      grew ||
      first ||
      (this.frames !== null && reading.frames < this.frames)
    ) {
      // A lower count is another receiver's (a new transceiver): progress.
      this.progressAt = reading.at;
    }
    this.frames = reading.frames;
    if (grew || first) this.played = true;
    if (this.played) {
      this.current =
        reading.at - this.progressAt >= this.stallAfterMs
          ? "stalled"
          : "playing";
    } else {
      this.current =
        reading.at - this.startedAt >= this.firstFrameTimeoutMs
          ? "stalled"
          : "waiting";
    }
    return this.current;
  }
}

/**
 * What a remote camera tile shows.
 * video: the camera. connecting: the loading state (a pull or its first
 * frame is on the way). unavailable: the avatar with "Video unavailable".
 */
export type CameraTileVideo = "video" | "connecting" | "unavailable";

export interface CameraTileInput {
  /** The tile has a live video track to render. */
  readonly hasTrack: boolean;
  /** That track's flow (undefined when nothing measures it). */
  readonly flow: VideoFlow | undefined;
  /** How long the tile has gone without showing video (0 while it does). */
  readonly waitingForMs: number;
}

/**
 * A camera announced on (the participant's self_video) with no track, or
 * one not yet decoding, shows the loading state this long, then
 * "unavailable". Covers a pull that decodes nothing in time plus the media
 * manager's one fresh re-pull of it (a pull with no track at all is pulled
 * again by its watchdog within this too).
 */
export const CAMERA_CONNECT_GRACE_MS =
  VIDEO_FIRST_FRAME_TIMEOUT_MS + VIDEO_RECOVERED_FIRST_FRAME_TIMEOUT_MS;

/** For a remote camera that is announced on. */
export function cameraTileVideo(input: CameraTileInput): CameraTileVideo {
  if (
    input.hasTrack &&
    (input.flow === undefined || input.flow === "playing")
  ) {
    return "video";
  }
  if (input.hasTrack && input.flow === "stalled") return "unavailable";
  return input.waitingForMs >= CAMERA_CONNECT_GRACE_MS
    ? "unavailable"
    : "connecting";
}

/** Copy shared by every client's tile. */
export const CAMERA_UNAVAILABLE_LABEL = "Video unavailable";
