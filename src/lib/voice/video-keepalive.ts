/**
 * A stand-in video source for a publication whose camera (or share) is off.
 *
 * The publication keeps its sender and its SFU track while it is off, so
 * turning it back on is a sender.replaceTrack() and viewers keep pulling the
 * same SFU track (see PartyTracksMediaManager.unpublishTrack). The SFU
 * garbage-collects a pushed track that receives no media for 30 s, so the
 * sender needs something to send: a tiny black frame each second, a few
 * hundred bytes per second, with no camera or capture held open.
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

export type CreateVideoKeepalive = () => VideoKeepalive | null;

/**
 * A thirtieth of the SFU's inactivity window (SFU_TRACK_INACTIVITY_GC_MS),
 * so a throttled or delayed timer still keeps the track.
 */
export const VIDEO_KEEPALIVE_FRAME_INTERVAL_MS = 1_000;
const WIDTH = 64;
const HEIGHT = 36;

type CaptureTrack = MediaStreamTrack & { requestFrame?: () => void };

/** A black canvas track painted once a second; null where canvases can't stream. */
export const createVideoKeepalive: CreateVideoKeepalive = () => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.captureStream !== "function") return null;
  // Frame rate 0: a frame goes out only on requestFrame(), one per paint.
  const track = canvas.captureStream(0).getVideoTracks()[0] as
    | CaptureTrack
    | undefined;
  if (!track) return null;
  let odd = false;
  let lastPaintAt = performance.now();
  let longestGap = 0;
  const paint = () => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - lastPaintAt);
    lastPaintAt = now;
    // Alternate two blacks so every frame is a change the encoder sends.
    odd = !odd;
    context.fillStyle = odd ? "#000000" : "#010101";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    track.requestFrame?.();
  };
  paint();
  const timer = setInterval(paint, VIDEO_KEEPALIVE_FRAME_INTERVAL_MS);
  return {
    track,
    longestGapMs: () => Math.max(longestGap, performance.now() - lastPaintAt),
    stop() {
      clearInterval(timer);
      track.stop();
    },
  };
};
