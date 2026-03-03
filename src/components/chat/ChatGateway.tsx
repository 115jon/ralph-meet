
import { useClerkTokenSync } from "@/lib/desktop-auth";
import { useChatStore } from "@/stores/chat-store";
import { useAuth } from "@clerk/tanstack-react-start";
import { useEffect, useRef } from "react";

/**
 * Headless component that initializes and manages the
 * Chat WebSocket Gateway connection upon mount.
 */
export function ChatGateway() {
  const { userId } = useAuth();
  const initGateway = useChatStore(s => s.gateway.initGateway);
  const setClerkUserId = useChatStore(s => s.gateway.setClerkUserId);
  const disconnectGateway = useChatStore(s => s.gateway.disconnectGateway);

  // Sync Clerk session tokens into localStorage for apiFetch (desktop only)
  // `tokenReady` is true once the first token has been stored (or immediately on web)
  const { tokenReady } = useClerkTokenSync();

  const disconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Wait for the token to be synced before initialising the gateway
    if (!tokenReady) return;

    // If there was a pending disconnect from a strict-mode unmount, cancel it.
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }

    initGateway(userId);

    return () => {
      // In React 18 strict mode, components unmount and remount immediately.
      // We delay the actual disconnect slightly so that if the component remounts
      // within that window, we preserve the active WebSocket session.
      disconnectTimeoutRef.current = setTimeout(() => {
        disconnectGateway();
      }, 500);
    };
  }, [initGateway, disconnectGateway, userId, tokenReady]);

  useEffect(() => {
    setClerkUserId(userId);
  }, [userId, setClerkUserId]);

  return null;
}
