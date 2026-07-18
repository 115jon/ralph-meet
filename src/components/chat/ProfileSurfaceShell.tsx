import type { CSSProperties, ReactNode } from "react";
import { forwardRef } from "react";

import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileFrameLayer } from "@/components/chat/ProfileFrameLayer";
import type { AvatarDisplay } from "@/lib/avatar-display";
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
  card: "relative h-full w-full overflow-hidden rounded-[28px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] shadow-[0_26px_64px_rgba(0,0,0,0.26)] backdrop-blur-[18px]",
  popover:
    "relative h-full w-full overflow-hidden rounded-[26px] border border-[color:var(--rm-profile-custom-card-border)] bg-rm-bg-elevated shadow-[0_24px_72px_rgba(0,0,0,0.58)]",
  sheet: "relative h-full w-full overflow-hidden bg-rm-bg-primary",
};

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
  return (
    <div
      ref={ref}
      {...props}
      className={cn("relative isolate overflow-visible", className)}
      style={style}
    >
      {renderFrame ? (
        <ProfileFrameLayer display={display} order="back" className="z-10" />
      ) : null}
      <div
        className={cn(SURFACE_CLASSES[variant], surfaceClassName)}
        style={{
          backgroundImage: "var(--rm-profile-custom-surface)",
          ...surfaceStyle,
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
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
            renderFrame={false}
          />
        </div>
        <div className="relative z-20 h-full">{children}</div>
      </div>
      {renderFrame ? (
        <ProfileFrameLayer display={display} order="front" className="z-40" />
      ) : null}
    </div>
  );
});
