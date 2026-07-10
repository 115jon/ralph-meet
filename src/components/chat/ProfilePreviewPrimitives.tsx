import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const PROFILE_SURFACE_ASPECT_RATIO = "450 / 880";

export function ProfilePreviewWidgetCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)]",
        className,
      )}
    >
      <div className="mb-4">
        <div className="text-[13px] font-semibold text-[color:var(--rm-profile-custom-text)]">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-1 text-[12px] text-[color:var(--rm-profile-custom-muted)]">
            {subtitle}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function ProfileSurfaceBackdrop({
  bannerUrl,
  bannerContentType,
  className,
  assetClassName,
}: {
  bannerUrl?: string | null;
  bannerContentType?: string | null;
  className?: string;
  assetClassName?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-[1] overflow-hidden",
        className,
      )}
    >
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
      />
      {bannerUrl ? (
        <div className="absolute inset-0 opacity-[0.4]">
          <ProfileAssetLayer
            url={bannerUrl}
            contentType={bannerContentType}
            alt="Profile banner backdrop"
            className={cn(
              "object-contain object-center scale-[1.02]",
              assetClassName,
            )}
          />
        </div>
      ) : null}
      <div
        className="absolute inset-0 opacity-80"
        style={{ background: "var(--rm-profile-custom-banner-overlay)" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.16)_0%,_rgba(255,255,255,0.04)_34%,_transparent_58%),linear-gradient(180deg,_rgba(8,10,16,0.08)_0%,_rgba(8,10,16,0.24)_42%,_rgba(8,10,16,0.64)_100%)]" />
    </div>
  );
}
