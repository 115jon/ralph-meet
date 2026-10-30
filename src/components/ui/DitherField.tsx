/**
 * DitherField — the app-wide version of the auth pages' dithered art.
 *
 * A square canvas (so dither cells stay square at any aspect) is centred in
 * the host and upscaled with `image-rendering: pixelated`. The greyscale
 * source field from `@/lib/auth-art` is painted on a 104×104 2D canvas and
 * ditherwave snaps it to a Bayer grid mapped onto a six-step ink ramp derived
 * from the active theme's `--rm-accent` / `--rm-bg-primary`.
 *
 * Still by default (talk-tree-spec §6, performance-motion P1-3): it paints
 * one frame, copies it to a plain 2D canvas and releases the GL context, so
 * nothing ticks while it is on screen. ditherwave's own rAF loop never
 * starts (see `createDitherWithoutLoop`).
 *
 * `animate` opts into a slow 12 fps drift for marketing/auth surfaces only.
 * It is ignored under reduced motion, and the timer skips frames while the
 * field is offscreen, the document is hidden or the app is inactive.
 *
 * Mounts after first paint (two frames + a macrotask), never during SSR, and
 * falls back to CSS gradients when WebGL2 is unavailable.
 */

import {
  artInks,
  isLightGround,
  mixHex,
  paintField,
  readThemeColors,
  SOURCE_SIZE,
  type ArtInks,
  type ThemeColors,
} from "@/lib/auth-art";
import { cn } from "@/lib/utils";
import { createDither, type DitherHandle } from "ditherwave";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const PIXEL_RATIO = 0.5;
/** Opt-in animation cadence (12 fps). */
const ANIMATE_INTERVAL_MS = 83;
const FALLBACK: ThemeColors = { accent: "#5865f2", background: "#070709" };

export interface DitherFieldProps {
  className?: string;
  style?: CSSProperties;
  /** Dither cell size in CSS px. 4 reads fine on small tiles, 5–6 on panels. */
  cell?: number;
  /** ditherwave intensity (0–1). Lower is quieter. */
  intensity?: number;
  /** Source contrast multiplier before the ramp lookup. */
  contrast?: number;
  /** Opacity of the art layer once live (0–1). */
  opacity?: number;
  /**
   * Opt into a slow drift (12 fps). In-app surfaces must not set it: a call
   * may be open behind them. Ignored under reduced motion.
   */
  animate?: boolean;
  /** Force a single frame even when `animate` is set. Still is the default. */
  still?: boolean;
  /** Time offset in seconds so neighbouring fields don't move in lockstep. */
  seed?: number;
  /** Override the ink ramp (defaults to the theme-derived ramp). */
  inks?: ArtInks;
  /** Fade the field toward `fadeTo` along one edge or radially. */
  fade?: "none" | "bottom" | "top" | "radial";
  /** Colour the fade resolves to. Defaults to the app ground. */
  fadeTo?: string;
  /**
   * `full` is the sign-in ramp (cores reach the darkest/lightest ink).
   * `quiet` caps the ramp near the ground so text laid over the field keeps
   * its contrast in every theme. Use it whenever copy sits on the art.
   */
  tone?: "full" | "quiet";
  /**
   * Paint a different greyscale source (mount-time). Defaults to the auth
   * field. It is drawn on the square SOURCE_SIZE canvas, of which a wide or
   * tall host shows only the centred slice. `t` is undefined for the still
   * frame.
   */
  paint?: FieldPainter;
}

export type FieldPainter = (
  ctx: CanvasRenderingContext2D,
  size: number,
  t?: number,
) => void;

/** Ramp for fields that sit behind text: never far from the ground. */
function quietInks({ accent, background }: ThemeColors): ArtInks {
  const steps = isLightGround(background)
    ? [0, 0.1, 0.2, 0.32, 0.45, 0.58]
    : [0, 0.16, 0.3, 0.44, 0.58, 0.72];
  return steps.map((t) => mixHex(background, accent, t)) as unknown as ArtInks;
}

function inksFor(colors: ThemeColors, tone: "full" | "quiet"): ArtInks {
  return tone === "quiet" ? quietInks(colors) : artInks(colors);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function fallbackBackground(inks: ArtInks): string {
  return [
    `radial-gradient(60% 55% at 60% 34%, ${inks[4]} 0%, ${rgba(inks[3], 0)} 70%)`,
    `radial-gradient(50% 50% at 24% 82%, ${inks[2]} 0%, ${rgba(inks[1], 0)} 72%)`,
    `linear-gradient(160deg, ${inks[0]} 0%, ${inks[1]} 100%)`,
  ].join(",");
}

/**
 * The fade is an overlay in the host's ground colour rather than a mask, so
 * it is theme-aware and survives the canvas being swapped for the still frame.
 */
function fadeOverlay(
  fade: NonNullable<DitherFieldProps["fade"]>,
  to: string,
): string | undefined {
  const clear = `color-mix(in srgb, ${to} 0%, transparent)`;
  switch (fade) {
    case "bottom":
      return `linear-gradient(180deg, ${clear} 35%, ${to} 100%)`;
    case "top":
      return `linear-gradient(0deg, ${clear} 35%, ${to} 100%)`;
    case "radial":
      return `radial-gradient(75% 75% at 50% 50%, ${clear} 25%, ${to} 100%)`;
    default:
      return undefined;
  }
}

/**
 * ditherwave's createDither() always starts a requestAnimationFrame loop that
 * redraws every vsync. Construct it with rAF stubbed out so that loop never
 * starts; callers draw with `handle.render()` when they mean to.
 */
function createDitherWithoutLoop(
  ...args: Parameters<typeof createDither>
): DitherHandle {
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 0;
  try {
    return createDither(...args);
  } finally {
    window.requestAnimationFrame = raf;
  }
}

function appInactive(): boolean {
  return document.documentElement.hasAttribute("data-app-inactive");
}

function cellResolution(cssSize: number, cell: number): number {
  return Math.max(48, Math.min(256, Math.round(cssSize / cell)));
}

export function DitherField({
  className,
  style,
  cell = 5,
  intensity = 0.55,
  contrast = 1.25,
  opacity = 1,
  animate = false,
  still = false,
  seed = 0,
  inks: inkOverride,
  fade = "none",
  fadeTo = "var(--rm-bg-primary)",
  tone = "full",
  paint = paintField,
}: DitherFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<DitherHandle | null>(null);
  const repaintStillRef = useRef<((palette: ArtInks) => void) | null>(null);
  const [colors, setColors] = useState<ThemeColors>(FALLBACK);
  const [live, setLive] = useState(false);

  // Follow the theme class on <html> directly. next-themes updates it in a
  // parent effect, which runs after this one, so `resolvedTheme` alone would
  // read the previous theme's colours.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const update = () => {
      const next = readThemeColors(root, FALLBACK);
      setColors((prev) =>
        prev.accent === next.accent && prev.background === next.background
          ? prev
          : next,
      );
    };
    update();
    if (typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const inks = inkOverride ?? inksFor(colors, tone);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let cleanup: (() => void) | null = null;

    const start = () => {
      if (disposed) return;
      const source = document.createElement("canvas");
      source.width = SOURCE_SIZE;
      source.height = SOURCE_SIZE;
      const ctx = source.getContext("2d");
      if (!ctx) return;

      const target = document.createElement("canvas");
      target.setAttribute("aria-hidden", "true");
      Object.assign(target.style, {
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        imageRendering: "pixelated",
        opacity: "0",
        transition: "opacity 600ms ease",
      } satisfies Partial<CSSStyleDeclaration>);

      const fit = () => {
        const size = Math.max(host.clientWidth, host.clientHeight, 1);
        target.style.width = `${size}px`;
        target.style.height = `${size}px`;
        return size;
      };
      let size = fit();
      host.appendChild(target);

      const frozen = !animate || still || prefersReducedMotion();
      const started = performance.now() - seed * 1000;
      const palette =
        inkOverride ??
        inksFor(readThemeColors(document.documentElement, FALLBACK), tone);
      let handle: DitherHandle;
      try {
        paint(ctx, SOURCE_SIZE, frozen ? undefined : seed);
        handle = createDitherWithoutLoop(target, source, {
          mode: "bayer",
          matrixSize: 8,
          resolution: cellResolution(size, cell),
          palette,
          intensity,
          contrast,
          animate: false,
          pauseOffscreen: true,
          pixelRatio: PIXEL_RATIO,
        });
      } catch {
        target.remove();
        return;
      }
      handleRef.current = handle;

      const reveal = () => {
        target.style.opacity = String(opacity);
        setLive(true);
      };

      if (frozen) {
        handle.render();
        const keep = document.createElement("canvas");
        keep.setAttribute("aria-hidden", "true");
        keep.width = target.width;
        keep.height = target.height;
        keep.style.cssText = target.style.cssText;
        keep.getContext("2d")?.drawImage(target, 0, 0);
        handle.destroy();
        handleRef.current = null;
        target.replaceWith(keep);
        requestAnimationFrame(() => {
          keep.style.opacity = String(opacity);
          setLive(true);
        });
        // A theme change repaints the still frame once (a short-lived GL
        // context on a detached canvas), then releases it again.
        repaintStillRef.current = (nextPalette) => {
          if (disposed) return;
          // Laid out like the visible frame (ditherwave sizes from layout),
          // but transparent, and removed as soon as it has been copied.
          const scratch = document.createElement("canvas");
          scratch.setAttribute("aria-hidden", "true");
          scratch.style.cssText = keep.style.cssText;
          scratch.style.transition = "none";
          scratch.style.opacity = "0";
          host.appendChild(scratch);
          try {
            const once = createDitherWithoutLoop(scratch, source, {
              mode: "bayer",
              matrixSize: 8,
              resolution: cellResolution(size, cell),
              palette: nextPalette,
              intensity,
              contrast,
              animate: false,
              pauseOffscreen: false,
              pixelRatio: PIXEL_RATIO,
            });
            once.render();
            const keepCtx = keep.getContext("2d");
            keepCtx?.clearRect(0, 0, keep.width, keep.height);
            keepCtx?.drawImage(scratch, 0, 0, keep.width, keep.height);
            once.destroy();
          } catch {
            /* keep the previous frame */
          } finally {
            scratch.remove();
          }
        };
        cleanup = () => {
          repaintStillRef.current = null;
          keep.remove();
        };
        return;
      }

      let visible = true;
      handle.render();
      const timer = window.setInterval(() => {
        if (disposed || !visible || document.hidden || appInactive()) return;
        paint(ctx, SOURCE_SIZE, (performance.now() - started) / 1000);
        handle.render();
      }, ANIMATE_INTERVAL_MS);
      requestAnimationFrame(reveal);

      const intersection =
        typeof IntersectionObserver === "function"
          ? new IntersectionObserver(
              (entries) => {
                visible = entries.some((entry) => entry.isIntersecting);
              },
              { threshold: 0 },
            )
          : null;
      intersection?.observe(host);

      const resize =
        typeof ResizeObserver === "function"
          ? new ResizeObserver(() => {
              const next = fit();
              if (next !== size) {
                size = next;
                handle.setOptions({ resolution: cellResolution(size, cell) });
              }
            })
          : null;
      resize?.observe(host);

      cleanup = () => {
        window.clearInterval(timer);
        intersection?.disconnect();
        resize?.disconnect();
        handle.destroy();
        handleRef.current = null;
        target.remove();
      };
    };

    const raf1 = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setTimeout(start, 0));
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(frame);
      cleanup?.();
      setLive(false);
    };
    // Geometry/intensity props are mount-time options by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.setOptions({ palette: inks });
      handleRef.current.render();
    } else {
      repaintStillRef.current?.(inks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, inkOverride]);

  const overlay = fadeOverlay(fade, fadeTo);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-live={live ? "true" : "false"}
      data-light={isLightGround(colors.background) ? "true" : "false"}
      className={cn(
        "rm-dither pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      style={{
        background: fallbackBackground(inks),
        ...style,
      }}
    >
      {overlay && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ background: overlay }}
        />
      )}
    </div>
  );
}

export default DitherField;
