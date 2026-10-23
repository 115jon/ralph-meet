/**
 * Split auth page: dithered art on one side, a flat 380px form column on the
 * other (12.15: no card, no border). Below `md` the art collapses to a top
 * band and the form owns the viewport. The form column scrolls internally on
 * very short screens; the default sign-in and the device review both fit
 * 1216×644 without it.
 */

import { AuthArtPanel } from "./AuthArtPanel";
import type { ReactNode } from "react";

export function AuthSplitLayout({
  children,
  caption,
  subtitle,
  align = "center",
}: {
  children: ReactNode;
  /** Text on the art panel (decorative; the art is aria-hidden). */
  caption?: string;
  /**
   * Context shown above the form, for pages that can't title themselves
   * (the Kova card has no title/subtitle props). Read by assistive tech.
   */
  subtitle?: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div className="auth-split grid min-h-dvh grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-rm-bg-primary text-rm-text antialiased md:grid-cols-2 md:grid-rows-1">
      <AuthArtPanel caption={caption} />
      <main
        className={`flex min-w-0 justify-center overflow-y-auto overscroll-contain px-[max(16px,var(--safe-area-right,0px))] pt-6 pb-[max(32px,var(--safe-area-bottom,0px))] md:px-6 md:pt-[max(32px,var(--safe-area-top,0px))] ${
          align === "center" ? "items-start md:items-center" : "items-start"
        }`}
      >
        <div className="w-full max-w-[380px]">
          {subtitle ? <div className="mb-6">{subtitle}</div> : null}
          {children}
        </div>
      </main>
    </div>
  );
}
