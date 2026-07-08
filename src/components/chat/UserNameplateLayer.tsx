import type { User } from "@/lib/types";

import { ProfileAssetLayer } from "./ProfileAssetLayer";
import { getUserNameplatePresentation, shouldUseNameplateIdentityFade } from "./user-nameplate-presentation";

type UserNameplateSource = Pick<User, "id" | "avatar_display" | "nameplate_url" | "nameplate_content_type"> | null | undefined;

interface UserNameplateLayerProps {
  user?: UserNameplateSource;
  nameplateUrl?: string | null;
  nameplateContentType?: string | null;
  avatarDisplay?: User["avatar_display"] | null;
  seedId?: string | null;
  alt: string;
  className?: string;
  playVideo?: boolean;
  maskFullOpacityStartPercent?: number;
}

export function UserNameplateLayer({
  user,
  nameplateUrl,
  nameplateContentType,
  avatarDisplay,
  seedId,
  alt,
  className,
  playVideo = true,
  maskFullOpacityStartPercent,
}: UserNameplateLayerProps) {
  const resolvedUrl = nameplateUrl ?? user?.nameplate_url ?? null;
  const resolvedContentType = nameplateContentType ?? user?.nameplate_content_type ?? null;

  const nameplatePresentation = getUserNameplatePresentation({
    id: seedId ?? user?.id ?? resolvedUrl ?? alt,
    avatar_display: avatarDisplay ?? user?.avatar_display ?? null,
    nameplate_url: resolvedUrl,
  });
  const useNameplateIdentityFade = shouldUseNameplateIdentityFade(nameplatePresentation.theme, {
    needsContrastAssist: nameplatePresentation.needsContrastAssist,
  });

  return (
    <ProfileAssetLayer
      url={resolvedUrl}
      contentType={resolvedContentType}
      alt={alt}
      className={className}
      playVideo={playVideo}
      maskPreset={useNameplateIdentityFade ? "nameplateIdentity" : undefined}
      maskFullOpacityStartPercent={useNameplateIdentityFade ? maskFullOpacityStartPercent : undefined}
    />
  );
}
