import { getDisplayName } from "@/lib/display-name";

export type VoiceIdentitySource = {
  name?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
};

function hasTextIdentity(source: VoiceIdentitySource): boolean {
  return source.display_name !== undefined || source.username !== undefined || source.name !== undefined;
}

export function resolveVoiceIdentity(...sources: Array<VoiceIdentitySource | null | undefined>) {
  const textSource = sources.find((source): source is VoiceIdentitySource => !!source && hasTextIdentity(source)) ?? {};
  let avatarUrl: string | null = null;
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i];
    if (source?.avatar_url) {
      avatarUrl = source.avatar_url;
      break;
    }
  }
  const displayName = getDisplayName(textSource, "Unknown");

  return {
    name: displayName,
    displayName,
    username: textSource.username?.trim() || displayName,
    avatarUrl,
  };
}
