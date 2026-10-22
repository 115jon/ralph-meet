/**
 * LoadingScreen: the one full-screen loading surface (splash, connection
 * overlay, desktop updater). The dithered field from the sign-in pages sits
 * behind a breathing logo and a 2 px accent progress line; callers put their
 * status copy in `children`.
 *
 * Motion: the logo breathe and the indeterminate bar are decorative loops and
 * stop under `prefers-reduced-motion` (see `styles.css`); a determinate bar
 * animates `transform` only.
 */

import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { DitherField } from "@/components/ui/DitherField";
import { cn } from "@/lib/utils";
import type { CSSProperties, ReactNode } from "react";

export interface LoadingScreenProps {
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the logo. Pass "" when adjacent text names the screen. */
  logoAlt?: string;
  logoTestId?: string;
  /** 0–100 for a determinate bar; omit for the indeterminate sweep. */
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
  const determinate = typeof progress === "number";

  return (
    <div
      className={cn(
        "relative flex select-none flex-col items-center justify-center overflow-hidden bg-rm-bg-primary font-ui",
        className,
      )}
      style={style}
    >
      <DitherField
        cell={6}
        intensity={0.45}
        opacity={0.9}
        fade="radial"
        tone="quiet"
      />

      <div className="rm-breathe relative z-10 flex h-24 w-24 items-center justify-center">
        <ThemeAwareSplashLogo
          alt={logoAlt}
          data-testid={logoTestId}
          className="h-full w-full object-contain"
        />
      </div>

      <div className="relative z-10 mt-8 h-0.5 w-40 overflow-hidden rounded-full bg-rm-text-ghost/40">
        {determinate ? (
          <div
            className="absolute inset-0 origin-left rounded-full bg-rm-accent transition-transform duration-200"
            style={{
              transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})`,
            }}
          />
        ) : (
          <div className="rm-loading-bar absolute inset-y-0 left-0 w-2/5 rounded-full bg-rm-accent" />
        )}
      </div>

      <div className="relative z-10 mt-4 flex flex-col items-center text-center">
        {children}
      </div>
    </div>
  );
}

export default LoadingScreen;
