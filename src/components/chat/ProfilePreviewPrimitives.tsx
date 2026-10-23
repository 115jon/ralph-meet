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
        "rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] p-4",
        className,
      )}
    >
      <div className="mb-4">
        <div className="text-ui-sm font-semibold text-[color:var(--rm-profile-custom-text)]">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-1 text-ui-xs text-[color:var(--rm-profile-custom-muted)]">
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
        "pointer-events-none absolute inset-0 z-10 overflow-hidden",
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
      {/* Fade into the profile surface so text below the backdrop stays
          legible in every theme (no fixed black/white wash). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--rm-profile-custom-background) 64%, transparent) 100%)",
        }}
      />
    </div>
  );
}
