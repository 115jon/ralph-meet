/**
 * Greyscale sources for `DitherField` beyond the auth field in `auth-art`.
 * Each painter draws on the square SOURCE_SIZE canvas; DitherField maps the
 * grey levels onto the theme's ink ramp (dark = ground, light = accent), so
 * the same source reads correctly in every theme.
 *
 * Both are still sources: they ignore `t`, so a field painted with them has
 * nothing to animate.
 */

/** Same shape as DitherField's `FieldPainter`, without importing the component. */
type GreyPainter = (ctx: CanvasRenderingContext2D, size: number) => void;

const grey = (value: number, alpha = 1): string => {
  const c = Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgba(${c},${c},${c},${alpha})`;
};

/**
 * A horizon: dark sky that brightens toward a lit line low in the band, a
 * wide elliptical glow on it, and ground that falls away fast below. The
 * field is square, so `aspect` (host height / width) says which centred
 * slice is on screen; `line` (0..1) is where the horizon sits in that slice.
 */
export function horizonPainter(aspect: number, line = 0.7): GreyPainter {
  // A host taller than it is wide shows the full square.
  const visible = Math.min(1, Math.max(0.05, aspect));
  return (ctx, size) => {
    const top = size * (0.5 - visible / 2);
    const h = size * visible;
    const horizon = top + h * line;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);

    const sky = ctx.createLinearGradient(0, top, 0, horizon);
    sky.addColorStop(0, grey(0, 0));
    sky.addColorStop(0.55, grey(1, 0.1));
    sky.addColorStop(1, grey(1, 0.42));
    ctx.fillStyle = sky;
    ctx.fillRect(0, top, size, horizon - top);

    ctx.globalCompositeOperation = "lighter";
    ctx.save();
    ctx.translate(size / 2, horizon);
    ctx.scale(1.5, (h * 0.62) / (size * 0.5));
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.5);
    glow.addColorStop(0, grey(1, 0.85));
    glow.addColorStop(0.3, grey(1, 0.46));
    glow.addColorStop(0.7, grey(1, 0.12));
    glow.addColorStop(1, grey(1, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();

    ctx.globalCompositeOperation = "source-over";
    const ground = ctx.createLinearGradient(0, horizon, 0, top + h);
    ground.addColorStop(0, grey(0, 0));
    ground.addColorStop(0.18, grey(0, 0.7));
    ground.addColorStop(1, grey(0, 0.96));
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, size, size - horizon);
  };
}

/** A rule: one row of light that runs out from the leading edge. */
export const rulePainter: GreyPainter = (ctx, size) => {
  const run = ctx.createLinearGradient(0, 0, size, 0);
  run.addColorStop(0, grey(0.95));
  run.addColorStop(0.18, grey(0.7));
  run.addColorStop(0.45, grey(0.34));
  run.addColorStop(0.75, grey(0.12));
  run.addColorStop(1, grey(0.03));
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = run;
  ctx.fillRect(0, 0, size, size);
};

// ── Cold-load source (one still frame per completed step) ──────────────
//
// The first-load screen repaints its field only when a step completes, so
// the painter takes the step count (0..3) and draws one still frame for it.
// Noise is seeded, so the same step always paints the same frame.

/** A small seeded PRNG (mulberry32): deterministic "noise" per frame. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grey noise over the whole square, `amount` 0..1, `cell` source px. */
function noise(
  ctx: CanvasRenderingContext2D,
  size: number,
  amount: number,
  seed: number,
  cell = 2,
  radial = false,
) {
  if (amount <= 0) return;
  const rand = seeded(seed);
  const c = size / 2;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const v = rand();
      // `radial`: thin out toward the edge, so the noise is a cloud round
      // the mark rather than a square.
      const d = radial ? Math.hypot(x - c, y - c) / c : 0;
      const local = radial ? amount * Math.max(0, 1 - d * d) : amount;
      if (v > 1 - local * 0.9) {
        ctx.fillStyle = grey(0.35 + rand() * 0.65, local);
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}

/**
 * "Resolve": the Ralph Meet mark resolving out of dither noise. Step 0 is
 * mostly noise with the mark barely in it; each completed step lifts tone
 * and sharpness; step 3 is the clean mark. `image` must already be loaded
 * (the painter draws synchronously); it is fitted to `fit` of the square,
 * centred.
 */
export function logoResolvePainter(
  step: number,
  image: CanvasImageSource & { width: number; height: number },
  fit = 0.92,
): GreyPainter {
  const s = Math.max(0, Math.min(3, step));
  return (ctx, size) => {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    const aspect = image.width / Math.max(1, image.height);
    const h = size * fit * (aspect > 1 ? 1 / aspect : 1);
    const w = h * aspect;
    ctx.save();
    ctx.globalAlpha = [0.32, 0.62, 0.88, 1][s]!;
    ctx.filter = s < 3 ? `blur(${[2.6, 1.3, 0.5][s]}px)` : "none";
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    ctx.restore();
    noise(ctx, size, [0.6, 0.34, 0.12, 0][s]!, 23 + s, 2, true);
  };
}
