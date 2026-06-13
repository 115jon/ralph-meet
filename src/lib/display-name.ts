type DisplayNameSource = {
  display_name?: string | null;
  username?: string | null;
  name?: string | null;
};

export function getDisplayName(source?: DisplayNameSource | null, fallback = "Unknown"): string {
  const displayName = source?.display_name?.trim();
  if (displayName) return displayName;

  const username = source?.username?.trim();
  if (username) return username;

  const name = source?.name?.trim();
  if (name) return name;

  return fallback;
}

export function getDisplayInitial(source?: DisplayNameSource | null, fallback = "?"): string {
  return getDisplayName(source, fallback).charAt(0).toUpperCase() || fallback;
}
