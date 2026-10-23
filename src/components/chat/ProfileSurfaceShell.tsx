import type { CSSProperties, ReactNode } from "react";
import { forwardRef } from "react";

import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileFrameLayer } from "@/components/chat/ProfileFrameLayer";
import type { AvatarDisplay } from "@/lib/avatar-display";
import {
  getProfileFrameReserveY,
  getProfileFrameSurfaceMarginStyle,
} from "@/lib/profile-frame";
import { cn } from "@/lib/utils";

export type ProfileSurfaceVariant = "card" | "popover" | "sheet";

interface ProfileSurfaceShellProps extends React.HTMLAttributes<HTMLDivElement> {
  display?: AvatarDisplay | string | null;
  variant?: ProfileSurfaceVariant;
  surfaceClassName?: string;
  surfaceStyle?: CSSProperties;
  effectStageClassName?: string;
  effectStageStyle?: CSSProperties;
  effectOpacity?: number;
  fit?: "contain" | "cover";
  playAnimation?: boolean;
  renderFrame?: boolean;
  children: ReactNode;
}

const SURFACE_CLASSES: Record<ProfileSurfaceVariant, string> = {
  // Dialog-sized profile card (modal, editor preview): radius 16, no shadow
  // of its own; the dialog that hosts it owns elevation.
  card: "rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-rm-bg-elevated bg-[var(--rm-profile-custom-background)]",
  // MENU_PANEL geometry (12.7): radius 12 and the one floating shadow.
  popover:
    "rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-rm-bg-elevated bg-[var(--rm-profile-custom-background)] shadow-lg",
  sheet: "bg-rm-bg-primary bg-[var(--rm-profile-custom-background)]",
};

/**
 * The profile card every profile surface draws (popover, account menu,
 * sheet, settings preview, picker previews), with its collectibles.
 *
 * Layering, back to front: back frame art (z-0), the card (z-10: theme
 * overlay, content, then the profile effect over the content), front frame
 * art (z-20). With a frame equipped the card is inset inside this box by the
 * frame's footprint, so the overhang stays inside the box: it never draws
 * over neighbouring text and a scroller or the viewport never clips it.
 * `--rm-profile-frame-reserve-y` holds that vertical inset for callers that
 * cap the card's height.
 */
export const ProfileSurfaceShell = forwardRef<
  HTMLDivElement,
  ProfileSurfaceShellProps
>(function ProfileSurfaceShell(
  {
    display,
    variant = "card",
    className,
    style,
    surfaceClassName,
    surfaceStyle,
    effectStageClassName,
    effectStageStyle,
    effectOpacity = 1,
    fit = "contain",
    playAnimation = true,
    renderFrame = true,
    children,
    ...props
  },
  ref,
) {
  const framed = renderFrame;
  return (
    <div
      ref={ref}
      {...props}
      data-profile-surface={variant}
      className={cn(
        "relative isolate flex flex-col [container-type:inline-size]",
        variant === "sheet"
          ? "overflow-hidden bg-rm-bg-primary bg-[var(--rm-profile-custom-background)]"
          : "overflow-visible",
        className,
      )}
      style={
        {
          "--rm-profile-frame-reserve-y": framed
            ? getProfileFrameReserveY(display)
            : "0px",
          ...(variant === "sheet"
            ? { backgroundImage: "var(--rm-profile-custom-surface)" }
            : {}),
          ...style,
        } as CSSProperties
      }
    >
      {framed ? (
        <ProfileFrameLayer display={display} order="back" className="z-0" />
      ) : null}
      <div
        data-profile-card=""
        className={cn(
          "relative z-10 min-h-0 flex-1 overflow-hidden",
          SURFACE_CLASSES[variant],
          surfaceClassName,
        )}
        style={{
          backgroundImage: "var(--rm-profile-custom-surface)",
          ...(framed ? getProfileFrameSurfaceMarginStyle(display) : {}),
          ...surfaceStyle,
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background: "var(--rm-profile-custom-surface-overlay-strong)",
          }}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-30",
            effectStageClassName,
          )}
          style={effectStageStyle}
        >
          <ProfileCollectiblesLayer
            display={display}
            effectOpacity={effectOpacity}
            fit={fit}
            playAnimation={playAnimation}
          />
        </div>
        <div className="relative z-20 h-full">{children}</div>
      </div>
      {framed ? (
        <ProfileFrameLayer display={display} order="front" className="z-20" />
      ) : null}
    </div>
  );
});
