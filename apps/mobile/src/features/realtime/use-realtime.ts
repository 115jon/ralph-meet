import { useEffect } from "react";
import { AppState } from "react-native";

import { useSession } from "@/features/auth/session";
import { startChatEvents } from "@/features/chat/realtime";
import { resetChatStore } from "@/features/chat/store";
import { startServerEvents } from "@/features/servers/realtime";
import { resetServersStore } from "@/features/servers/store";

import { connectGateway, wakeGateway } from "./gateway";

/**
 * Runs the chat socket while signed in: connects once the profile (the
 * Identify user id) is known, drops it and every cached server and message
 * on sign-out, and wakes it when the app returns to the front, the phone's
 * counterpart of the web's page-wake (visibility, online, pageshow).
 */
export function useRealtime(): void {
  const userId = useSession((s) =>
    s.status === "signed-in" ? (s.user?.id ?? null) : null,
  );
  const signedOut = useSession((s) => s.status === "signed-out");

  useEffect(() => {
    const stopServers = startServerEvents();
    const stopChat = startChatEvents();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") wakeGateway();
    });
    return () => {
      stopServers();
      stopChat();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    connectGateway(userId);
  }, [userId]);

  useEffect(() => {
    if (!signedOut) return;
    resetServersStore();
    resetChatStore();
  }, [signedOut]);
}
