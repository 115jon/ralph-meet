"use client";

import { useChatStore } from "@/stores/chat-store";
import { useAuth } from "@clerk/nextjs";
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

  const disconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
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
  }, [initGateway, disconnectGateway, userId]);

  useEffect(() => {
    setClerkUserId(userId);
  }, [userId, setClerkUserId]);

  return null;
}
