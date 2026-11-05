// The web's keepalive for a withdrawn video publication: a black canvas
// track painted once a second. The contract is @ralph/voice-media's
// VideoKeepalive.
import {
  VIDEO_KEEPALIVE_FRAME_INTERVAL_MS,
  type CreateVideoKeepalive,
} from "@ralph/voice-media";

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
