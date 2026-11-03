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
