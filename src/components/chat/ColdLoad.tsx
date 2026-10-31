/**
 * The cold-load screen (picked 2026-10-30, variant B): the Ralph Meet mark
 * resolving out of dither noise, one stage per completed connection step,
 * and one live status line.
 *
 *   Phone (<640px)   the mark full width in the upper space, the status as a
 *                    poster line anchored low in the thumb zone.
 *   Wider            a compact plate in the middle of the viewport (mark over
 *                    status) on a dimmed, still outline of the app, so it
 *                    reads as an overlay over the app that is coming, not a
 *                    page of its own.
 *
 * The mark changes only when a step completes; nothing loops. Each step is
 * one still frame (DitherField paints once and releases its GL context),
 * cached per step, theme and size so the route splash and the connection
 * overlay hand off without the mark blinking. Under reduced motion frames
 * swap with no fade. The art is aria-hidden and hidden under forced colours;
 * the status text is the accessible progress (role=status, polite).
 */
import splashLogo from "@/assets/splash-logo.svg";
import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { Button } from "@/components/ui/button";
import { DitherField } from "@/components/ui/DitherField";
import { Skeleton } from "@/components/ui/skeleton";
import { artInks, readThemeColors, type ArtInks } from "@/lib/auth-art";
import { logoResolvePainter } from "@/lib/dither-painters";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

export type ColdStep = 0 | 1 | 2 | 3;
export type ColdError = "auth" | "offline" | "slow" | null;

// ── The resolving mark ─────────────────────────────────────────────────

let logoImage: HTMLImageElement | null = null;
let logoWaiters: ((img: HTMLImageElement) => void)[] | null = null;

/** The splash mark, loaded once per page, so the painter draws it synchronously. */
function useLogoImage(): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(logoImage);
  useEffect(() => {
    if (logoImage) return;
    if (!logoWaiters) {
      logoWaiters = [];
      const image = new Image();
      image.onload = () => {
        logoImage = image;
        logoWaiters?.forEach((done) => done(image));
        logoWaiters = null;
      };
      image.src = splashLogo;
    }
    logoWaiters.push(setImg);
  }, []);
  return img;
}

/** Painted frames, by step, theme ground/accent and size, as data URLs. */
const frameCache = new Map<string, string>();

function themeInks(): { key: string; inks: ArtInks } | null {
  if (typeof document === "undefined") return null;
  const colors = readThemeColors(document.documentElement);
  const ramp = artInks(colors);
  // The ramp's first step folded onto the ground: empty source reads as
  // clean canvas instead of a faint checker.
  return {
    key: `${colors.accent}|${colors.background}`,
    inks: [ramp[0], ramp[0], ramp[2], ramp[3], ramp[4], ramp[5]],
  };
}

/**
 * One step's still frame. A frame painted before (the splash painted step 0
 * a moment ago) shows at once from the cache; a new one paints, fades in
 * over the previous step, and is cached once live.
 */
function StepFrame({
  step,
  img,
  cell,
  cacheKey,
  inks,
  over,
}: {
  step: ColdStep;
  img: HTMLImageElement;
  cell: number;
  cacheKey: string;
  inks: ArtInks;
  /** Painted over an earlier frame: no fallback ground of its own. */
  over: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cached = frameCache.get(cacheKey);

  useEffect(() => {
    if (cached) return;
    const host = hostRef.current;
    if (!host) return;
    const field = host.querySelector<HTMLElement>("[data-live]");
    if (!field) return;
    const save = () => {
      const canvas = field.querySelector("canvas");
      if (!canvas || field.dataset.live !== "true") return false;
      try {
        frameCache.set(cacheKey, canvas.toDataURL());
      } catch {
        /* a tainted or lost canvas: just repaint next time */
      }
      return true;
    };
    if (save()) return;
    const observer = new MutationObserver(() => {
      if (save()) observer.disconnect();
    });
    observer.observe(field, {
      attributes: true,
      attributeFilter: ["data-live"],
    });
    return () => observer.disconnect();
  }, [cached, cacheKey]);

  if (cached) {
    return (
      <img
        alt=""
        src={cached}
        className="absolute inset-0 size-full [image-rendering:pixelated]"
      />
    );
  }
  return (
    <div ref={hostRef} className="absolute inset-0">
      <DitherField
        cell={cell}
        contrast={1.15}
        intensity={0.6}
        paint={logoResolvePainter(step, img)}
        inks={inks}
        style={{ background: over ? "transparent" : "var(--ply-0)" }}
      />
    </div>
  );
}

/**
 * The Ralph Meet mark resolving from dither noise, one stage per completed
 * step. At step 3 the real mark (the lockup's SVG) settles over the dither,
 * so the hand-off to the app lands on the logo itself.
 */
function LogoResolve({
  step,
  className,
  cell: cellProp,
}: {
  step: ColdStep;
  className?: string;
  /** Dither cell in CSS px; by default ~90-100 cells across the mark. */
  cell?: number;
}) {
  const img = useLogoImage();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [theme] = useState(themeInks);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setWidth(Math.round(host.clientWidth / 8) * 8);
  }, []);

  const cell = cellProp ?? (width > 0 && width < 300 ? 2 : 4);
  const layers: ColdStep[] = step > 0 ? [(step - 1) as ColdStep, step] : [step];
  const ready = img && theme && width > 0;
  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-slot="logo-resolve"
      data-step={step}
      className={cn("relative aspect-square", className)}
    >
      {ready ? (
        <div className="absolute inset-0 overflow-hidden forced-colors:hidden motion-reduce:[&_canvas]:transition-none!">
          {layers.map((s, i) => (
            <StepFrame
              key={s}
              step={s}
              img={img}
              cell={cell}
              inks={theme.inks}
              cacheKey={`${s}|${theme.key}|${width}|${cell}`}
              over={i > 0}
            />
          ))}
        </div>
      ) : null}
      <ThemeAwareSplashLogo
        alt=""
        className={cn(
          "absolute inset-[4%] size-[92%] object-contain transition-opacity duration-500 ease-out motion-reduce:transition-none",
          step >= 3 ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

// ── The status ─────────────────────────────────────────────────────────

const STEP_LINES = [
  { line: "Signing you in", detail: "Checking your session on this device." },
  { line: "Opening chat", detail: "Connecting to the chat server." },
  {
    line: "Loading messages",
    detail: "Fetching your servers and what you missed.",
  },
  { line: "You're in", detail: "Welcome back." },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * One live status: a silkscreen kicker with a three-cell step meter, one
 * Bricolage line that changes as steps complete, a quiet detail and, for a
 * failure, one key.
 */
function ColdStatus({
  step,
  error,
  onSignIn,
  onReload,
  focusAction = false,
  className,
}: {
  step: ColdStep;
  error: ColdError;
  onSignIn?: () => void;
  onReload?: () => void;
  /** Move focus to Sign in when it appears (the live overlay, not specimens). */
  focusAction?: boolean;
  className?: string;
}) {
  const signInRef = useRef<HTMLButtonElement>(null);
  const showSignIn = error === "auth" && !!onSignIn;
  // The app beneath is inert, so Sign in is the only thing to do: put the
  // keyboard and the screen reader on it.
  useEffect(() => {
    if (focusAction && showSignIn) signInRef.current?.focus();
  }, [focusAction, showSignIn]);
  const current = Math.min(step, 2);
  const copy =
    error === "auth"
      ? {
          kicker: "01 / 03 · Session",
          line: "Your session expired",
          detail: "Sign in again to open chat. Nothing is lost.",
        }
      : error === "offline"
        ? {
            kicker: `${pad(current + 1)} / 03 · Offline`,
            line: "Waiting for network",
            detail:
              "Ralph connects on its own as soon as this device is back online.",
          }
        : error === "slow"
          ? {
              kicker: `${pad(current + 1)} / 03 · Slow`,
              line: "Taking longer than usual",
              detail: "The server is slow to answer. Keep waiting, or reload.",
            }
          : {
              kicker:
                step >= 3 ? "03 / 03 · Ready" : `${pad(current + 1)} / 03`,
              ...STEP_LINES[step],
            };
  const tone =
    error === "auth"
      ? "text-danger-ink"
      : error
        ? "text-warning-ink"
        : "text-ink-3";
  return (
    <div data-slot="cold-status" className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-3" aria-hidden="true">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "h-0.5 w-6",
                error === "auth" && i === 0
                  ? "bg-danger-ink"
                  : i < step
                    ? "bg-ink-1"
                    : i === current && step < 3
                      ? error
                        ? "bg-warning-ink"
                        : "bg-ink-3"
                      : "bg-line-strong",
              )}
            />
          ))}
        </div>
        <span className={cn("silkscreen", tone)}>{copy.kicker}</span>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="mt-4 font-display text-[36px] leading-[36px] font-extrabold tracking-[-0.03em] text-balance text-ink-1 sm:mt-3 sm:text-[30px] sm:leading-[32px]">
          {copy.line}
        </p>
        <p className="mt-3 max-w-[40ch] text-ui-sm text-pretty text-ink-2 sm:mt-2">
          {copy.detail}
        </p>
      </div>
      {showSignIn ? (
        <Button
          ref={signInRef}
          size="lg"
          variant="primary"
          className="mt-6 w-full sm:mt-5"
          onClick={onSignIn}
        >
          Sign in
        </Button>
      ) : error === "slow" && onReload ? (
        <Button
          size="lg"
          variant="secondary"
          className="mt-6 w-full sm:mt-5"
          onClick={onReload}
        >
          Reload
        </Button>
      ) : null}
    </div>
  );
}

// ── The backdrop (wider screens) ───────────────────────────────────────

/** A dimmed, still outline of the app behind the plate. No shimmer. */
function ShellOutline() {
  const rows = [72, 56, 64, 48, 80, 60];
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex flex-col opacity-60"
    >
      <div className="hidden h-8 shrink-0 border-b border-line md:block" />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[60px] shrink-0 flex-col items-center gap-2 pt-3 md:flex">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="size-10 rounded-[2px]" />
          ))}
        </div>
        <div className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-ply-1 md:flex">
          <div className="flex h-12 items-center border-b border-line px-4">
            <Skeleton className="h-4 w-28 rounded-[2px]" />
          </div>
          <div className="flex flex-col gap-0.5 p-2 pt-4">
            <Skeleton className="mb-3 ml-2 h-3 w-24 rounded-[2px]" />
            {rows.slice(0, 5).map((w, i) => (
              <div key={i} className="flex h-8 items-center gap-2 px-2">
                <Skeleton className="size-4 rounded-[2px]" />
                <Skeleton
                  className="h-3 rounded-[2px]"
                  style={{ width: w + 24 }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
            <Skeleton className="size-5 rounded-[2px]" />
            <Skeleton className="h-4 w-32 rounded-[2px]" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-6 px-4 pb-4">
            {rows.map((w, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-10 shrink-0 rounded-[2px]" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className="h-3 w-24 rounded-[2px]" />
                  <Skeleton
                    className="h-3 rounded-[2px]"
                    style={{ width: `${w}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="shrink-0 px-4 pb-4">
            <div className="h-12 rounded-[2px] border border-line bg-ply-2" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The screen ─────────────────────────────────────────────────────────

/**
 * The whole cold-load screen. Callers own the logic (the connection
 * overlay, the route splash); this only draws a step and an error.
 */
export function ColdLoadScreen({
  step,
  error = null,
  onSignIn,
  onReload,
  focusAction,
  className,
}: {
  step: ColdStep;
  error?: ColdError;
  onSignIn?: () => void;
  onReload?: () => void;
  /** Move focus to Sign in when it appears (see ColdStatus). */
  focusAction?: boolean;
  className?: string;
}) {
  const markStep: ColdStep = error === "auth" ? 0 : step;
  return (
    <div
      data-slot="cold-load"
      className={cn(
        "relative flex flex-col overflow-hidden bg-ply-0 font-ui text-ink-1 select-none",
        "pt-[var(--safe-area-top,0px)] pb-[calc(var(--safe-area-bottom,0px)+32px)] sm:items-center sm:justify-start sm:p-6 sm:pt-[max(24px,calc(50dvh-190px))]",
        className,
      )}
    >
      <div className="hidden sm:contents">
        <ShellOutline />
        <div aria-hidden="true" className="absolute inset-0 bg-scrim" />
      </div>
      <div
        data-slot="cold-plate"
        className="relative flex min-h-0 flex-1 flex-col sm:w-[400px] sm:flex-none sm:rounded-[2px] sm:border sm:border-t-2 sm:border-line-strong sm:border-t-ink-1 sm:bg-ply-0 sm:p-8"
      >
        <div className="flex min-h-0 flex-1 items-center justify-center sm:flex-none">
          <LogoResolve
            step={markStep}
            className="w-full max-w-[460px] sm:w-[184px]"
          />
        </div>
        <ColdStatus
          step={step}
          error={error}
          onSignIn={onSignIn}
          onReload={onReload}
          focusAction={focusAction}
          className="px-6 sm:mt-8 sm:px-0"
        />
      </div>
    </div>
  );
}
