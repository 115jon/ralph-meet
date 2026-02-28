import { useChatStore } from "@/stores/chat-store";

interface FallbackUser {
  username?: string | null;
  avatar_url?: string | null;
  [key: string]: any;
}

/**
 * Hook to resolve a user's real-time username and avatar_url from the client store.
 * Useful for keeping avatars fresh anywhere a user ID is referenced (e.g., messages,
 * notifications, replies) without needing to hit the DB repeatedly.
 *
 * It checks the server members list first, then the friends/relationships list,
 * and finally falls back to the object provided by the DB endpoint.
 */
export function useUserResolution(userId?: string | null, fallback?: FallbackUser | null) {
  // Use a targeted selector so the component doesn't over-render when other members change
  const member = useChatStore(s =>
    userId ? s.members.find(m => m.user.id === userId) : undefined
  );

  const relationship = useChatStore(s =>
    userId ? s.relationships.find(r => r.user.id === userId) : undefined
  );

  const username = member?.user.username || relationship?.user.username || fallback?.username || "Unknown";
  const avatarUrl = member?.user.avatar_url || relationship?.user.avatar_url || fallback?.avatar_url || null;

  return { username, avatarUrl };
}
