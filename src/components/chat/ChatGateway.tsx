"use client";

import { useChatStore } from "@/stores/chat-store";
import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";

/**
 * Headless component that initializes and manages the
 * Chat WebSocket Gateway connection upon mount.
 */
export function ChatGateway() {
  const { userId } = useAuth();
  const initGateway = useChatStore(s => s.gateway.initGateway);
  const setClerkUserId = useChatStore(s => s.gateway.setClerkUserId);
  const disconnectGateway = useChatStore(s => s.gateway.disconnectGateway);

  useEffect(() => {
    initGateway(userId);
    return () => disconnectGateway();
  }, [initGateway, disconnectGateway, userId]);

  useEffect(() => {
    setClerkUserId(userId);
  }, [userId, setClerkUserId]);

  return null;
}
