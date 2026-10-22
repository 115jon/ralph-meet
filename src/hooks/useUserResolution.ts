import { getDisplayName } from "@/lib/display-name";
import type { AvatarDisplay } from "@/lib/avatar-display";
import type { DisplayNameStyle } from "@/lib/profile-customization";
import { useChatStore } from "@/stores/chat-store";

interface FallbackUser {
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: AvatarDisplay | string | null;
  display_name_style?: DisplayNameStyle | string | null;
  [key: string]: any;
}

interface MemberLike {
  user: { id: string };
}

export function findCachedMember<T extends MemberLike>(
  members: T[] | undefined,
  membersByServerId: Record<string, T[]>,
  userId: string,
): T | undefined {
  const active = members?.find((member) => member.user.id === userId);
  if (active) return active;
  for (const list of Object.values(membersByServerId)) {
    const cached = list.find((member) => member.user.id === userId);
    if (cached) return cached;
  }
  return undefined;
}

/**
 * Hook to resolve a user's real-time username, display_name and avatar_url from the client store.
 * Useful for keeping avatars fresh anywhere a user ID is referenced (e.g., messages,
 * notifications, replies) without needing to hit the DB repeatedly.
 *
 * It checks the server members list first, then the friends/relationships list,
 * and finally falls back to the object provided by the DB endpoint.
 */
export function useUserResolution(
  userId?: string | null,
  fallback?: FallbackUser | null,
) {
  const user = useChatStore((s) =>
    userId && s.user?.id === userId ? s.user : undefined,
  );

  const member = useChatStore((s) =>
    userId
      ? findCachedMember(s.members, s.membersByServerId, userId)
      : undefined,
  );

  const relationship = useChatStore((s) =>
    userId ? s.relationships.find((r) => r.user.id === userId) : undefined,
  );

  const dmRecipient = useChatStore((s) =>
    userId
      ? s.dmChannels.find((dm) => dm.recipient?.id === userId)?.recipient
      : undefined,
  );

  const resolvedUser =
    user || member?.user || relationship?.user || dmRecipient || fallback;

  const username = resolvedUser?.username || fallback?.username || "Unknown";
  const displayName = getDisplayName(resolvedUser, username);
  const avatarUrl = resolvedUser?.avatar_url || fallback?.avatar_url || null;
  const avatarDisplay =
    resolvedUser?.avatar_display ?? fallback?.avatar_display ?? null;
  const displayNameStyle =
    resolvedUser?.display_name_style ?? fallback?.display_name_style ?? null;

  return { username, displayName, avatarUrl, avatarDisplay, displayNameStyle };
}
