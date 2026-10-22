/**
 * Split auth page: dithered art on one side, a 380px form column on the
 * other. Below `md` the art collapses to a top band and the form owns the
 * viewport. The form column scrolls internally on very short screens; the
 * default sign-in and the device review both fit 1216×644 without it.
 */

import { AuthArtPanel } from "./AuthArtPanel";
import type { ReactNode } from "react";

export function AuthSplitLayout({
  children,
  caption,
  align = "center",
}: {
  children: ReactNode;
  caption?: string;
  align?: "center" | "start";
}) {
  return (
    <div className="auth-split grid min-h-svh grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-[var(--rm-bg-primary)] text-[var(--rm-text-primary)] antialiased selection:bg-[var(--rm-accent)]/40 md:grid-cols-2 md:grid-rows-1 2xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
      <AuthArtPanel caption={caption} />
      <main
        className={`flex min-w-0 justify-center overflow-y-auto overscroll-contain px-[max(20px,env(safe-area-inset-right))] pb-[max(28px,env(safe-area-inset-bottom))] pt-6 md:px-6 md:pt-[max(28px,env(safe-area-inset-top))] ${
          align === "center" ? "items-start md:items-center" : "items-start"
        }`}
      >
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
