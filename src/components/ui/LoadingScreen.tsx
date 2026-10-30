/**
 * LoadingScreen: the one full-screen loading surface (splash, first-connect
 * overlay, desktop updater). The still dithered mark (DitherGlyph) sits
 * over the Ralph Meet lockup on the bare canvas; callers put their status
 * copy in `children`.
 *
 * Motion: none. The mark prints half-resolved for the first 10 s and whole
 * after (one timeout, no ticking), so nothing runs behind a game. A
 * determinate `progress` draws a 2px bar that moves by `transform` only
 * when the value changes.
 */

import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { DitherGlyph } from "@/components/ui/dither-glyph";
import { cn } from "@/lib/utils";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/** How long the loader animates before it settles into a still frame. */
export const LOADER_SETTLE_MS = 10_000;

/** True once `ms` have passed since mount (one timeout, no ticking). */
export function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return elapsed;
}

export interface LoadingScreenProps {
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the logo. Pass "" when adjacent text names the screen. */
  logoAlt?: string;
  logoTestId?: string;
  /** 0–100 for a determinate bar; omit for none. */
  progress?: number;
  children?: ReactNode;
}

export function LoadingScreen({
  className,
  style,
  logoAlt = "Ralph Meet",
  logoTestId,
  progress,
  children,
}: LoadingScreenProps) {
  const settled = useElapsed(LOADER_SETTLE_MS);
  const determinate = typeof progress === "number";

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden bg-ply-0 font-ui text-ink-1 select-none",
        className,
      )}
      style={style}
    >
      <DitherGlyph motif="mark" size="md" pending={!settled} />

      <div className="mt-8 flex items-center gap-2.5">
        <ThemeAwareSplashLogo
          alt={logoAlt}
          data-testid={logoTestId}
          className="size-7 object-contain"
        />
        <span
          aria-hidden={logoAlt ? true : undefined}
          className="text-ui-md font-semibold text-ink-1"
        >
          Ralph Meet
        </span>
      </div>

      {determinate ? (
        <div className="mt-6 h-0.5 w-40 overflow-hidden rounded-full bg-tint-2">
          <div
            className="h-full origin-left rounded-full bg-primary-fill transition-transform duration-(--dur-3) ease-out"
            style={{
              transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})`,
            }}
          />
        </div>
      ) : null}

      <div className="mt-3 flex min-h-5 flex-col items-center text-center">
        {children}
      </div>
    </div>
  );
}

export default LoadingScreen;
