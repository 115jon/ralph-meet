import type { CSSProperties, ReactNode } from "react";
import { forwardRef } from "react";

import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileFrameLayer } from "@/components/chat/ProfileFrameLayer";
import type { AvatarDisplay } from "@/lib/avatar-display";
import type { ProfileEffectPlaybackMode } from "@/lib/profile-effect-playback";
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
  /** Effect playback: `once` per open (profiles) or `loop` (shop stages). */
  effectPlayback?: ProfileEffectPlaybackMode;
  /** Change it to replay the effect once its pass has ended. */
  effectReplayKey?: number;
  renderFrame?: boolean;
  children: ReactNode;
}

const SURFACE_CLASSES: Record<ProfileSurfaceVariant, string> = {
  // Dialog-sized profile card (the profile modal): radius 12, the dialog
  // ladder's shape. Its host adds the modal shadow.
  card: "rounded-xl border border-line bg-[var(--rm-profile-custom-background)]",
  // Popover geometry (talk-tree-spec §7): radius 10 and the float shadow.
  popover:
    "rounded-lg border border-line bg-[var(--rm-profile-custom-background)] shadow-float",
  sheet: "bg-[var(--rm-profile-custom-background)]",
};

/**
 * The shell every profile surface draws (ProfileCard, picker previews), with
 * its collectibles. The card colour is `--rm-profile-custom-background`
 * (ProfileCard points it at ply-3 for profiles without custom colours);
 * borders read `--line`, which a custom colourway re-points.
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
    effectPlayback = "once",
    effectReplayKey,
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
          ? "overflow-hidden bg-[var(--rm-profile-custom-background)]"
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
            playback={effectPlayback}
            replayKey={effectReplayKey}
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
