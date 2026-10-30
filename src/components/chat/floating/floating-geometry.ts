/**
 * Geometry for floating players (now playing, stream previews, soundboard).
 *
 * Players live in one of four corners. Dragging moves them freely; letting go
 * projects the release velocity forward (iOS picture-in-picture style) and
 * snaps to the corner nearest the projected point, so a flick towards a
 * corner is enough. Corners sit inside the safe area and clear of the chrome
 * that marks itself `data-floating-avoid` (composer, tab bar, voice dock).
 */

export type FloatingCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const FLOATING_CORNERS: readonly FloatingCorner[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
];

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AvoidRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const isLeftCorner = (corner: FloatingCorner) =>
  corner === "top-left" || corner === "bottom-left";
export const isTopCorner = (corner: FloatingCorner) =>
  corner === "top-left" || corner === "top-right";

export function cornerFrom(top: boolean, left: boolean): FloatingCorner {
  return `${top ? "top" : "bottom"}-${left ? "left" : "right"}`;
}

/** Gap kept between a player and the chrome it avoids, and between players. */
export const FLOATING_GAP = 8;

/**
 * How far the chrome reaches into the top and bottom of the viewport within
 * one column (`left`..`right`). Rects in the top half push the top inset
 * down; rects in the bottom half push the bottom inset up. Anything taller
 * than 60% of the viewport (a sidebar, a page) is not chrome and is ignored.
 */
export function avoidInsetsForColumn(
  rects: readonly AvoidRect[],
  column: { left: number; right: number },
  viewport: Size,
  base: { top: number; bottom: number },
): { top: number; bottom: number } {
  let top = base.top;
  let bottom = base.bottom;
  for (const rect of rects) {
    const height = rect.bottom - rect.top;
    if (height <= 0 || height > viewport.height * 0.6) continue;
    if (rect.right <= column.left || rect.left >= column.right) continue;
    const middle = (rect.top + rect.bottom) / 2;
    if (middle > viewport.height / 2) {
      bottom = Math.max(bottom, viewport.height - rect.top + FLOATING_GAP);
    } else {
      top = Math.max(top, rect.bottom + FLOATING_GAP);
    }
  }
  return { top, bottom };
}

/** Top-left point of a player of `size` parked in `corner`. */
export function cornerPosition(
  corner: FloatingCorner,
  size: Size,
  viewport: Size,
  insets: Insets,
  stackOffset = 0,
): Point {
  const x = isLeftCorner(corner)
    ? insets.left
    : viewport.width - insets.right - size.width;
  const y = isTopCorner(corner)
    ? insets.top + stackOffset
    : viewport.height - insets.bottom - size.height - stackOffset;
  // A player wider or taller than the room left still starts on screen.
  return {
    x: Math.max(insets.left, Math.min(x, viewport.width - size.width)),
    y: Math.max(0, Math.min(y, viewport.height - size.height)),
  };
}

/**
 * Distance a flick carries on, in px, for a release velocity in px/ms. The
 * UIScrollView deceleration rate (0.998 per ms) gives v * 0.998 / 0.002.
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998) {
  return (velocity * decelerationRate) / (1 - decelerationRate);
}

/** Corner whose quadrant holds the player's projected centre. */
export function snapCorner(
  position: Point,
  size: Size,
  velocity: Point,
  viewport: Size,
): FloatingCorner {
  const centreX = position.x + size.width / 2 + projectMomentum(velocity.x);
  const centreY = position.y + size.height / 2 + projectMomentum(velocity.y);
  return cornerFrom(
    centreY < viewport.height / 2,
    centreX < viewport.width / 2,
  );
}

/** Corner reached by an arrow key from `corner` (keyboard alternative to drag). */
export function cornerForArrow(
  corner: FloatingCorner,
  key: string,
): FloatingCorner | null {
  const top = isTopCorner(corner);
  const left = isLeftCorner(corner);
  switch (key) {
    case "ArrowUp":
      return cornerFrom(true, left);
    case "ArrowDown":
      return cornerFrom(false, left);
    case "ArrowLeft":
      return cornerFrom(top, true);
    case "ArrowRight":
      return cornerFrom(top, false);
    default:
      return null;
  }
}

/** Next corner clockwise (a click on the move handle). */
export function nextCorner(corner: FloatingCorner): FloatingCorner {
  const index = FLOATING_CORNERS.indexOf(corner);
  return FLOATING_CORNERS[(index + 1) % FLOATING_CORNERS.length]!;
}

/**
 * Past the viewport edge a dragged player follows the finger with growing
 * resistance instead of stopping dead.
 */
export function rubberBand(value: number, min: number, max: number) {
  const damp = (overshoot: number) =>
    (1 - 1 / ((overshoot * 0.55) / 120 + 1)) * 120;
  if (value < min) return min - damp(min - value);
  if (value > max) return max + damp(value - max);
  return value;
}

/** Release velocity (px/ms) from the last ~100ms of pointer samples. */
export function releaseVelocity(
  samples: ReadonlyArray<{ t: number; x: number; y: number }>,
): Point {
  if (samples.length < 2) return { x: 0, y: 0 };
  const last = samples[samples.length - 1]!;
  let first = samples[0]!;
  for (const sample of samples) {
    if (last.t - sample.t <= 100) {
      first = sample;
      break;
    }
  }
  const dt = last.t - first.t;
  if (dt <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

export function clampWidth(width: number, range: { min: number; max: number }) {
  return Math.round(Math.min(range.max, Math.max(range.min, width)));
}

export interface FloatingPrefs {
  corner: FloatingCorner;
  minimized: boolean;
  width?: number;
}

const STORAGE_PREFIX = "rm:floating:v1:";

export function readFloatingPrefs(
  id: string,
  fallback: FloatingPrefs,
): FloatingPrefs {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FloatingPrefs>;
    return {
      corner: FLOATING_CORNERS.includes(parsed.corner as FloatingCorner)
        ? (parsed.corner as FloatingCorner)
        : fallback.corner,
      minimized:
        typeof parsed.minimized === "boolean"
          ? parsed.minimized
          : fallback.minimized,
      width:
        typeof parsed.width === "number" && Number.isFinite(parsed.width)
          ? parsed.width
          : fallback.width,
    };
  } catch {
    return fallback;
  }
}

export function writeFloatingPrefs(id: string, prefs: FloatingPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(prefs));
  } catch {
    // Private mode or a full quota: the player just forgets its spot.
  }
}
