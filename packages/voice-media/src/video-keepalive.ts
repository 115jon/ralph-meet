/**
 * A stand-in video source for a publication whose camera (or share) is off.
 *
 * The publication keeps its sender and its SFU track while it is off, so
 * turning it back on is a sender.replaceTrack() and viewers keep pulling the
 * same SFU track (see PartyTracksMediaManager.unpublishTrack). The SFU
 * garbage-collects a pushed track that receives no media for 30 s, so the
 * sender needs something to send: a tiny black frame each second, a few
 * hundred bytes per second, with no camera or capture held open.
 *
 * Platforms make the track: the web paints a canvas
 * (src/lib/voice/video-keepalive.ts); the Expo app opens a native black
 * frame source (apps/mobile, features/voice/keepalive.ts).
 */
export interface VideoKeepalive {
  readonly track: MediaStreamTrack;
  /**
   * The longest it has gone without sending a frame, up to now. Past the
   * SFU's inactivity window (a throttled timer) the SFU may have dropped the
   * track.
   */
  longestGapMs(): number;
  stop(): void;
}

/** A keepalive now, or null where none can be made (the push is closed). */
export type CreateVideoKeepalive = () => VideoKeepalive | null;

/**
 * A thirtieth of the SFU's inactivity window (SFU_TRACK_INACTIVITY_GC_MS),
 * so a throttled or delayed timer still keeps the track.
 */
export const VIDEO_KEEPALIVE_FRAME_INTERVAL_MS = 1_000;

/** No keepalive: a withdrawn video publication is closed like audio. */
export const noVideoKeepalive: CreateVideoKeepalive = () => null;
