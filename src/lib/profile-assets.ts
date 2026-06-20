export type ProfileAssetKind = "banner" | "nameplate";

export const PROFILE_ASSET_PREFIX = "profile-assets";

export function isProfileAssetKind(value: unknown): value is ProfileAssetKind {
  return value === "banner" || value === "nameplate";
}

export function getProfileAssetStoragePrefix(kind: ProfileAssetKind, userId: string) {
  return `${PROFILE_ASSET_PREFIX}/${kind}/${userId}.`;
}

export function getProfileAssetStorageKey(kind: ProfileAssetKind, userId: string, ext: string) {
  return `${PROFILE_ASSET_PREFIX}/${kind}/${userId}.${ext}`;
}

export function getProfileAssetUrl(kind: ProfileAssetKind, userId: string, ext: string) {
  return `/api/profile-assets/${kind}/${userId}.${ext}`;
}
