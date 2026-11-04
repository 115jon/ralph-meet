// Camera simulcast: what a publisher sends and which layer a viewer pulls.
//
// The camera is pushed as three encodings, highest first. Their RIDs sort
// the same way (f < h < q), which is the order the SFU's `asciibetical`
// fallback ranks them in when the preferred layer is not being sent (the
// partytracks proxy asks for that fallback on every pull).
//
// A viewer pulls the layer that covers the largest size its video elements
// render the track at: a full-stage or fullscreen tile takes `f`, a grid tile
// `h` or `q`, a track nothing renders `q`.

export type VideoLayerQuality = "low" | "medium" | "high";

/** Device pixels a rendered video spans (CSS size × devicePixelRatio). */
export interface RenderedVideoSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The camera's simulcast encodings, highest first. The top layer keeps the
 * browser's default bitrate for the capture size, as a single-layer camera
 * did; the lower two are capped so a grid of tiles stays cheap.
 */
export const CAMERA_SIMULCAST_ENCODINGS: readonly RTCRtpEncodingParameters[] = [
  { rid: "f", active: true, scaleResolutionDownBy: 1 },
  { rid: "h", active: true, scaleResolutionDownBy: 2, maxBitrate: 500_000 },
  {
    rid: "q",
    active: true,
    scaleResolutionDownBy: 4,
    maxBitrate: 150_000,
    maxFramerate: 15,
  },
];

/**
 * Up to this many source pixels wide, the quarter layer is enough (320 px of
 * a 720p camera, 480 px of a 1080p one).
 */
export const LOW_LAYER_MAX_WIDTH = 360;
/** Up to this, the half layer (640 px of 720p, 960 px of 1080p). */
export const MEDIUM_LAYER_MAX_WIDTH = 800;

/** Cameras are 16:9; a tall box needs as many source pixels as its height implies. */
const CAMERA_ASPECT = 16 / 9;

const QUALITY_RANK: Record<VideoLayerQuality, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function compareVideoLayerQuality(
  left: VideoLayerQuality,
  right: VideoLayerQuality,
): number {
  return QUALITY_RANK[left] - QUALITY_RANK[right];
}

/**
 * The layer a remote camera needs for the largest size it is rendered at; a
 * track nothing renders (null, or a hidden 0×0 element) gets the low layer.
 */
export function resolveVideoLayerQuality(
  size: RenderedVideoSize | null,
): VideoLayerQuality {
  if (!size || size.width <= 0 || size.height <= 0) return "low";
  const sourceWidth = Math.max(size.width, size.height * CAMERA_ASPECT);
  if (sourceWidth <= LOW_LAYER_MAX_WIDTH) return "low";
  if (sourceWidth <= MEDIUM_LAYER_MAX_WIDTH) return "medium";
  return "high";
}

/**
 * The RID to pull for a quality, from the RIDs the publisher announced
 * (highest first). Undefined for a publication without simulcast: it is
 * pulled as its single layer.
 */
export function selectSimulcastRid(
  quality: VideoLayerQuality,
  rids: readonly string[] | undefined,
): string | undefined {
  if (!rids || rids.length < 2) return undefined;
  switch (quality) {
    case "high":
      return rids[0];
    case "low":
      return rids[rids.length - 1];
    case "medium":
      return rids[Math.floor((rids.length - 1) / 2)];
  }
}

/** The larger of two rendered sizes, by the source width each needs. */
export function largerRenderedSize(
  left: RenderedVideoSize | null,
  right: RenderedVideoSize,
): RenderedVideoSize {
  if (!left) return right;
  const need = (size: RenderedVideoSize) =>
    Math.max(size.width, size.height * CAMERA_ASPECT);
  return need(right) > need(left) ? right : left;
}
