/**
 * Dithered art panel for the auth pages (sign-in, sign-up, /activate).
 *
 * A square canvas (so the dither cells stay square on any panel) renders at
 * half CSS resolution and is upscaled with `image-rendering: pixelated`.
 * The source field is painted at ~30 fps on a 104×104 2D canvas and
 * ditherwave re-uploads it each frame. Mounts after first paint; honours
 * prefers-reduced-motion (one frame, GL released); stops painting while the
 * tab is hidden; falls back to CSS gradients without WebGL2.
 *
 * Inks follow the active theme: `--rm-accent` and `--rm-bg-primary` are read
 * from the document whenever next-themes resolves a new theme.
 */

import {
  artInks,
  cellResolution,
  isLightGround,
  mixHex,
  paintField,
  readThemeColors,
  SOURCE_SIZE,
  type ArtInks,
  type ThemeColors,
} from "@/lib/auth-art";
import { createDither, type DitherHandle } from "ditherwave";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const PIXEL_RATIO = 0.5;
const FALLBACK: ThemeColors = { accent: "#5865f2", background: "#070709" };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function rgba(hex: string, alpha: number): string {
  const h = hex.slice(1);
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function fallbackStyle(inks: ArtInks): CSSProperties {
  return {
    background: [
      `radial-gradient(60% 55% at 60% 34%, ${inks[4]} 0%, ${rgba(inks[3], 0)} 70%)`,
      `radial-gradient(50% 50% at 24% 82%, ${inks[2]} 0%, ${rgba(inks[1], 0)} 72%)`,
      `linear-gradient(160deg, ${inks[0]} 0%, ${inks[1]} 100%)`,
    ].join(","),
  };
}

export function AuthArtPanel({ caption = "Ralph Meet" }: { caption?: string }) {
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<DitherHandle | null>(null);
  const [colors, setColors] = useState<ThemeColors>(FALLBACK);
  const [live, setLive] = useState(false);

  // Theme → colours. Runs after next-themes has applied the class.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const next = readThemeColors(document.documentElement, FALLBACK);
    setColors((prev) =>
      prev.accent === next.accent && prev.background === next.background
        ? prev
        : next,
    );
  }, [resolvedTheme]);

  const inks = artInks(colors);

  // Mount the dither once, after first paint.
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
      target.className = "auth-art-canvas";
      const fit = () => {
        const size = Math.max(host.clientWidth, host.clientHeight, 1);
        target.style.width = `${size}px`;
        target.style.height = `${size}px`;
        return size;
      };
      let size = fit();
      host.appendChild(target);

      const still = prefersReducedMotion();
      const started = performance.now();
      let handle: DitherHandle;
      try {
        paintField(ctx, SOURCE_SIZE, still ? undefined : 0);
        handle = createDither(target, source, {
          mode: "bayer",
          matrixSize: 8,
          resolution: cellResolution(size),
          palette: artInks(readThemeColors(document.documentElement, FALLBACK)),
          intensity: 0.55,
          contrast: 1.25,
          animate: false,
          pauseOffscreen: true,
          pixelRatio: PIXEL_RATIO,
        });
      } catch {
        target.remove();
        return;
      }
      handleRef.current = handle;

      if (still) {
        handle.render();
        const keep = document.createElement("canvas");
        keep.className = "auth-art-canvas";
        keep.width = target.width;
        keep.height = target.height;
        keep.style.width = target.style.width;
        keep.style.height = target.style.height;
        keep.getContext("2d")?.drawImage(target, 0, 0);
        handle.destroy();
        handleRef.current = null;
        target.replaceWith(keep);
        setLive(true);
        cleanup = () => keep.remove();
        return;
      }

      let last = 0;
      const tick = (now: number) => {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        if (document.hidden || now - last < 30) return;
        last = now;
        paintField(ctx, SOURCE_SIZE, (now - started) / 1000);
      };
      frame = requestAnimationFrame(tick);
      requestAnimationFrame(() => setLive(true));

      const observer =
        typeof ResizeObserver === "function"
          ? new ResizeObserver(() => {
              const next = fit();
              if (next !== size) {
                size = next;
                handle.setOptions({ resolution: cellResolution(size) });
              }
            })
          : null;
      observer?.observe(host);

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer?.disconnect();
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
  }, []);

  // Re-ink the live dither when the theme changes.
  useEffect(() => {
    handleRef.current?.setOptions({ palette: inks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors]);

  const light = isLightGround(colors.background);
  const seam = rgba(colors.background, 0.55);
  const foot = rgba(colors.background, 0.72);

  return (
    <aside
      ref={hostRef}
      aria-hidden="true"
      data-live={live ? "true" : "false"}
      className="auth-art relative isolate overflow-hidden border-[var(--rm-border)] max-md:h-[calc(152px+env(safe-area-inset-top))] max-md:border-b md:border-r"
      style={{ background: inks[1] }}
    >
      <div className="absolute inset-0 z-0" style={fallbackStyle(inks)} />
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: [
            `linear-gradient(90deg, rgba(0,0,0,0) 82%, ${seam} 100%)`,
            `linear-gradient(0deg, ${foot} 0%, ${rgba(colors.background, 0)} 24%)`,
          ].join(","),
        }}
      />
      <div
        className="absolute bottom-[max(24px,env(safe-area-inset-bottom))] left-[max(28px,env(safe-area-inset-left))] z-10 max-w-[calc(100%-56px)] truncate text-ui-sm font-semibold tracking-[-0.005em] max-md:bottom-[18px] max-md:left-[max(20px,env(safe-area-inset-left))]"
        style={{
          color: light ? mixHex(colors.accent, "#000000", 0.55) : "#ffffff",
          textShadow: light ? "none" : "0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        {caption}
      </div>
    </aside>
  );
}
