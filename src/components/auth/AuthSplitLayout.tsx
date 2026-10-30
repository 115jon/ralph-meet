/**
 * Auth entry pages (sign-in, sign-up, /activate): the public frame with the
 * sign-in dither on its leading edge (a band on phones). The field is
 * still and decorative; nothing here runs a loop.
 */

import type { ReactNode } from "react";
import { PublicFrame } from "./PublicFrame";

export function AuthSplitLayout({
  children,
  subtitle,
}: {
  children: ReactNode;
  /**
   * Context shown above the form, for pages that can't title themselves
   * (the Kova card has no title/subtitle props). Read by assistive tech.
   */
  subtitle?: ReactNode;
}) {
  return (
    <PublicFrame label="Access">
      {subtitle ? <div className="mb-8">{subtitle}</div> : null}
      {children}
    </PublicFrame>
  );
}
