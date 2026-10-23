/**
 * LandingField: the full-bleed, input-driven dithered field behind the
 * landing page. A square 2D source (`./landing-field`) is painted at ~30 fps
 * and ditherwave snaps it to a Bayer grid on a theme-derived ink ramp, like
 * `DitherField` and the auth art panel. What is new here:
 *
 *  - `interactive`: on fine pointers the lights follow the cursor with a
 *    lagging ease, so the field feels like it notices you;
 *  - `progress`: anything with `get(): number` (a framer MotionValue works)
 *    drives the scroll phase, which tilts the sweeps and dims the field;
 *  - `tone`: `full` is the sign-in ramp, `quiet` stays near the ground so
 *    copy can sit on it.
 *
 * Cheap by construction: mounts after first paint, paints only while on
 * screen and the tab is visible, renders one frame and releases the GL
 * context under reduced motion or `still`, and falls back to CSS gradients
 * without WebGL2. Nothing here blocks the SSR hero, which is plain text.
 */

import {
  artInks,
  isLightGround,
  mixHex,
  readThemeColors,
  type ArtInks,
  type ThemeColors,
} from "@/lib/auth-art";
import { cn } from "@/lib/utils";
import { createDither, type DitherHandle } from "ditherwave";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  LANDING_SOURCE_SIZE,
  LANDING_STILL_TIME,
  paintLandingField,
  pointerToField,
  type LandingFieldState,
} from "./landing-field";

const PIXEL_RATIO = 0.5;
const FRAME_INTERVAL_MS = 33;
const POINTER_EASE = 0.055;
const FALLBACK: ThemeColors = { accent: "#5865f2", background: "#070709" };

export interface LandingFieldProps {
  className?: string;
  /** Dither cell size in CSS px. */
  cell?: number;
  intensity?: number;
  contrast?: number;
  /** Opacity of the art layer once live. */
  opacity?: number;
  /** One frame only, regardless of the motion preference. */
  still?: boolean;
  /** Time offset so two fields never move in lockstep. */
  seed?: number;
  /** Lights follow the pointer (fine pointers only). */
  interactive?: boolean;
  /** Scroll phase source, 0..1. Read every frame, never subscribed. */
  progress?: { get(): number };
  tone?: "full" | "quiet";
  fade?: "none" | "bottom" | "top" | "both";
}

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

function hasFinePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches
  );
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; // ds-allow:raw-color theme-derived ink, see auth-art
}

function fallbackBackground(inks: ArtInks): string {
  return [
    `radial-gradient(60% 55% at 60% 40%, ${inks[4]} 0%, ${rgba(inks[3], 0)} 70%)`, // ds-allow:raw-color theme-derived ink
    `radial-gradient(50% 50% at 22% 76%, ${inks[2]} 0%, ${rgba(inks[1], 0)} 72%)`, // ds-allow:raw-color theme-derived ink
    `linear-gradient(160deg, ${inks[0]} 0%, ${inks[1]} 100%)`,
  ].join(",");
}

function cellResolution(cssSize: number, cell: number): number {
  return Math.max(64, Math.min(320, Math.round(cssSize / cell)));
}

export function LandingField({
  className,
  cell = 6,
  intensity = 0.55,
  contrast = 1.3,
  opacity = 1,
  still = false,
  seed = 0,
  interactive = false,
  progress,
  tone = "full",
  fade = "none",
}: LandingFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<DitherHandle | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [colors, setColors] = useState<ThemeColors>(FALLBACK);
  const [live, setLive] = useState(false);

  // Follow the theme class on <html>: next-themes flips it in a parent
  // effect, so reading `resolvedTheme` here would lag one theme behind.
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

  const inks = inksFor(colors, tone);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let cleanup: (() => void) | null = null;

    const start = () => {
      if (disposed) return;
      const source = document.createElement("canvas");
      source.width = LANDING_SOURCE_SIZE;
      source.height = LANDING_SOURCE_SIZE;
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
        transition: "opacity 700ms ease",
      } satisfies Partial<CSSStyleDeclaration>);

      const fit = () => {
        const size = Math.max(host.clientWidth, host.clientHeight, 1);
        target.style.width = `${size}px`;
        target.style.height = `${size}px`;
        return size;
      };
      let size = fit();
      host.appendChild(target);

      const frozen = still || prefersReducedMotion();
      const started = performance.now() - seed * 1000;
      const state: LandingFieldState = {
        t: LANDING_STILL_TIME,
        pointer: null,
        scroll: 0,
      };
      const palette = inksFor(
        readThemeColors(document.documentElement, FALLBACK),
        tone,
      );
      let handle: DitherHandle;
      try {
        paintLandingField(ctx, LANDING_SOURCE_SIZE, state);
        handle = createDither(target, source, {
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
        cleanup = () => keep.remove();
        return;
      }

      // Pointer: the target is where the cursor is; `state.pointer` eases
      // toward it every frame so the lights lag like something with mass.
      let pointerTarget: { x: number; y: number } | null = null;
      const surface = host.parentElement ?? host;
      const onMove = (event: PointerEvent) => {
        pointerTarget = pointerToField(
          event.clientX,
          event.clientY,
          host.getBoundingClientRect(),
        );
      };
      const onLeave = () => {
        pointerTarget = null;
      };
      const tracking = interactive && hasFinePointer();
      if (tracking) {
        surface.addEventListener("pointermove", onMove, { passive: true });
        surface.addEventListener("pointerleave", onLeave);
      }

      let visible = true;
      let last = 0;
      const tick = (now: number) => {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        if (!visible || document.hidden || now - last < FRAME_INTERVAL_MS)
          return;
        last = now;
        state.t = (now - started) / 1000;
        const raw = progressRef.current?.get() ?? 0;
        state.scroll = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        if (pointerTarget) {
          if (!state.pointer) {
            state.pointer = { ...pointerTarget };
          } else {
            state.pointer.x +=
              (pointerTarget.x - state.pointer.x) * POINTER_EASE;
            state.pointer.y +=
              (pointerTarget.y - state.pointer.y) * POINTER_EASE;
          }
        } else if (state.pointer) {
          // Drift home, then let go.
          const home = { x: 0.6, y: 0.4 };
          state.pointer.x += (home.x - state.pointer.x) * POINTER_EASE;
          state.pointer.y += (home.y - state.pointer.y) * POINTER_EASE;
          if (
            Math.abs(home.x - state.pointer.x) < 0.004 &&
            Math.abs(home.y - state.pointer.y) < 0.004
          ) {
            state.pointer = null;
          }
        }
        paintLandingField(ctx, LANDING_SOURCE_SIZE, state);
      };
      frame = requestAnimationFrame(tick);
      requestAnimationFrame(() => {
        target.style.opacity = String(opacity);
        setLive(true);
      });

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
        cancelAnimationFrame(frame);
        intersection?.disconnect();
        resize?.disconnect();
        if (tracking) {
          surface.removeEventListener("pointermove", onMove);
          surface.removeEventListener("pointerleave", onLeave);
        }
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
    // Geometry and intensity are mount-time options by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.setOptions({ palette: inks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors]);

  const clear = "color-mix(in srgb, var(--rm-bg-primary) 0%, transparent)";
  const overlay =
    fade === "bottom"
      ? `linear-gradient(180deg, ${clear} 42%, var(--rm-bg-primary) 100%)`
      : fade === "top"
        ? `linear-gradient(0deg, ${clear} 42%, var(--rm-bg-primary) 100%)`
        : fade === "both"
          ? `linear-gradient(180deg, color-mix(in srgb, var(--rm-bg-primary) 70%, transparent) 0%, ${clear} 18%, ${clear} 46%, var(--rm-bg-primary) 100%)`
          : undefined;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-live={live ? "true" : "false"}
      className={cn(
        "rm-home-field pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      style={{ background: fallbackBackground(inks) } satisfies CSSProperties}
    >
      {overlay ? (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ background: overlay }}
        />
      ) : null}
    </div>
  );
}

export default LandingField;
