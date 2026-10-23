/**
 * The greyscale source field behind the landing page's hero and platform
 * sections. Same family as `@/lib/auth-art` (a few lit forms over deep
 * ground, snapped to a Bayer grid by ditherwave), but this one is composed
 * for a full-bleed viewport and takes input: the pointer pulls the lights,
 * and scroll progress tilts the sweeps, lifts the lights, and dims the
 * whole field so it dissolves into the page as the hero leaves.
 *
 * Pure helpers only; the React side lives in `./LandingField`.
 */

export const LANDING_SOURCE_SIZE = 112;

/** Time the still frame (reduced motion, `still`) is rendered at. */
export const LANDING_STILL_TIME = 7;

export interface LandingFieldState {
  /** Seconds since mount (plus seed). */
  t: number;
  /** Pointer in field space, 0..1 on each axis. `null` when the pointer is away. */
  pointer: { x: number; y: number } | null;
  /** 0 at the top of the hero, 1 when it has scrolled out. */
  scroll: number;
}

interface Light {
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  wx: number;
  wy: number;
  phase: number;
  r: number;
  a: number;
  /** How far (0..1) the light slides toward the pointer. */
  pull: number;
}

const LIGHTS: Light[] = [
  {
    cx: 0.6,
    cy: 0.4,
    ax: 0.08,
    ay: 0.06,
    wx: 0.11,
    wy: 0.08,
    phase: 0.6,
    r: 0.6,
    a: 0.86,
    pull: 0.18,
  },
  {
    cx: 0.22,
    cy: 0.76,
    ax: 0.1,
    ay: 0.05,
    wx: 0.07,
    wy: 0.1,
    phase: 2.4,
    r: 0.42,
    a: 0.52,
    pull: 0.1,
  },
  {
    cx: 0.88,
    cy: 0.9,
    ax: 0.05,
    ay: 0.04,
    wx: 0.09,
    wy: 0.06,
    phase: 4.1,
    r: 0.32,
    a: 0.34,
    pull: 0.06,
  },
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lightPosition(
  light: Light,
  state: LandingFieldState,
  size: number,
): { x: number; y: number } {
  const { t, pointer, scroll } = state;
  let x = light.cx + light.ax * Math.sin(t * light.wx + light.phase);
  let y = light.cy + light.ay * Math.cos(t * light.wy + light.phase * 0.7);
  if (pointer) {
    x += (pointer.x - x) * light.pull;
    y += (pointer.y - y) * light.pull;
  }
  y -= scroll * 0.32;
  return { x: x * size, y: y * size };
}

/**
 * A broad diagonal band of light: the "sweep" that reads as a river of
 * colour once dithered. `angle` in radians, `cx/cy` in 0..1, `peak` 0..1.
 */
function paintSweep(
  ctx: CanvasRenderingContext2D,
  size: number,
  angle: number,
  cx: number,
  cy: number,
  width: number,
  peak: number,
) {
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const half = size * 1.1;
  const x = cx * size;
  const y = cy * size;
  const band = ctx.createLinearGradient(
    x - nx * half,
    y - ny * half,
    x + nx * half,
    y + ny * half,
  );
  const w = width / 2;
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(clamp01(0.5 - w * 1.6), "rgba(255,255,255,0)");
  band.addColorStop(
    clamp01(0.5 - w * 0.45),
    `rgba(255,255,255,${peak * 0.55})`,
  );
  band.addColorStop(0.5, `rgba(255,255,255,${peak})`);
  band.addColorStop(clamp01(0.5 + w * 0.6), `rgba(255,255,255,${peak * 0.4})`);
  band.addColorStop(clamp01(0.5 + w * 1.7), "rgba(255,255,255,0)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, size, size);
}

function paintShadow(
  ctx: CanvasRenderingContext2D,
  size: number,
  state: LandingFieldState,
) {
  const { t, scroll } = state;
  const angle = 1.05 + 0.05 * Math.sin(t * 0.06 + 0.8) - scroll * 0.25;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const cx = size * (0.46 + 0.03 * Math.sin(t * 0.08));
  const cy = size * (0.56 - scroll * 0.3);
  const half = size * 0.62;
  const band = ctx.createLinearGradient(
    cx - nx * half,
    cy - ny * half,
    cx + nx * half,
    cy + ny * half,
  );
  band.addColorStop(0, "rgba(0,0,0,0)");
  band.addColorStop(0.38, "rgba(0,0,0,0)");
  band.addColorStop(0.5, "rgba(0,0,0,0.78)");
  band.addColorStop(0.6, "rgba(0,0,0,0.46)");
  band.addColorStop(0.78, "rgba(0,0,0,0)");
  band.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, size, size);
}

/** Paints the greyscale field for `state` onto a `size` x `size` 2D context. */
export function paintLandingField(
  ctx: CanvasRenderingContext2D,
  size: number,
  state: LandingFieldState,
): void {
  const { t, scroll } = state;
  const dim = 1 - 0.55 * clamp01(scroll);

  ctx.globalCompositeOperation = "source-over";
  const ground = ctx.createLinearGradient(0, size * 0.1, size, size * 0.9);
  ground.addColorStop(0, "#000000");
  ground.addColorStop(0.5, "#050505");
  ground.addColorStop(1, "#101010");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "lighter";

  // Two crossing sweeps. The first is the main river; the second is a
  // fainter echo that crosses it lower down, so the field never reads as
  // one symmetric stripe.
  const tilt = scroll * 0.35;
  paintSweep(
    ctx,
    size,
    -0.58 + 0.07 * Math.sin(t * 0.05) + tilt,
    0.42 + 0.06 * Math.sin(t * 0.07 + 1.1),
    0.64 - scroll * 0.38,
    0.26,
    0.5 * dim,
  );
  paintSweep(
    ctx,
    size,
    0.72 + 0.05 * Math.sin(t * 0.045 + 2.2) - tilt * 0.6,
    0.7,
    0.3 - scroll * 0.2 + 0.04 * Math.cos(t * 0.06),
    0.16,
    0.22 * dim,
  );

  for (const light of LIGHTS) {
    const { x, y } = lightPosition(light, state, size);
    const radius = light.r * size;
    const a = light.a * dim;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(255,255,255,${a})`);
    glow.addColorStop(0.12, `rgba(255,255,255,${a * 0.7})`);
    glow.addColorStop(0.4, `rgba(255,255,255,${a * 0.3})`);
    glow.addColorStop(0.75, `rgba(255,255,255,${a * 0.06})`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  ctx.globalCompositeOperation = "source-over";
  paintShadow(ctx, size, state);
}

/**
 * Pointer position in field space. The dither canvas is a centred square of
 * `size` CSS px inside a `width` x `height` host, so the host's own
 * coordinates have to be shifted by the overhang on the long axis.
 */
export function pointerToField(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const size = Math.max(rect.width, rect.height, 1);
  const dx = (rect.width - size) / 2;
  const dy = (rect.height - size) / 2;
  return {
    x: clamp01((clientX - rect.left - dx) / size),
    y: clamp01((clientY - rect.top - dy) / size),
  };
}
