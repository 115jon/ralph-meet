import { getDisplayName } from "@/lib/display-name";
import { useChatStore } from "@/stores/chat-store";

interface FallbackUser {
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  [key: string]: any;
}

/**
 * Hook to resolve a user's real-time username, display_name and avatar_url from the client store.
 * Useful for keeping avatars fresh anywhere a user ID is referenced (e.g., messages,
 * notifications, replies) without needing to hit the DB repeatedly.
 *
 * It checks the server members list first, then the friends/relationships list,
 * and finally falls back to the object provided by the DB endpoint.
 */
export function useUserResolution(userId?: string | null, fallback?: FallbackUser | null) {
  const user = useChatStore(s =>
    userId && s.user?.id === userId ? s.user : undefined
  );

  // Use a targeted selector so the component doesn't over-render when other members change
  const member = useChatStore(s =>
    userId ? s.members.find(m => m.user.id === userId) : undefined
  );

  const cachedMember = useChatStore(s =>
    userId
      ? Object.values(s.membersByServerId)
        .flat()
        .find(m => m.user.id === userId)
      : undefined
  );

  const relationship = useChatStore(s =>
    userId ? s.relationships.find(r => r.user.id === userId) : undefined
  );

  const dmRecipient = useChatStore(s =>
    userId ? s.dmChannels.find(dm => dm.recipient?.id === userId)?.recipient : undefined
  );

  const resolvedUser = user
    || member?.user
    || cachedMember?.user
    || relationship?.user
    || dmRecipient
    || fallback;

  const username = resolvedUser?.username || fallback?.username || "Unknown";
  const displayName = getDisplayName(resolvedUser, username);
  const avatarUrl = resolvedUser?.avatar_url || fallback?.avatar_url || null;

  return { username, displayName, avatarUrl };
}
