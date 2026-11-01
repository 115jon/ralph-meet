import { useEffect } from "react";
import { AppState } from "react-native";

import { startActivityEvents } from "@/features/activity/realtime";
import { resetActivityStore } from "@/features/activity/store";
import { useSession } from "@/features/auth/session";
import { clearTypingTimers } from "@/features/chat/actions";
import { startChatEvents } from "@/features/chat/realtime";
import { resetDrafts } from "@/features/chat/drafts";
import { resetLibrary } from "@/features/chat/picker/library";
import { resetRecents } from "@/features/chat/picker/recents";
import { resetChatStore } from "@/features/chat/store";
import { resetConversation } from "@/features/conversation/store";
import { startDmEvents } from "@/features/dms/realtime";
import { resetDmsStore } from "@/features/dms/store";
import { startPresenceEvents } from "@/features/presence/realtime";
import { startServerEvents } from "@/features/servers/realtime";
import { resetServersStore } from "@/features/servers/store";
import { leaveCall, wakeCall } from "@/features/voice/actions";

import { connectGateway, wakeGateway } from "./gateway";

/**
 * Runs the chat socket while signed in: connects once the profile (the
 * Identify user id) is known, drops it and everything cached (servers,
 * messages, DMs, activity, the call) on sign-out, and wakes it when the app returns to the front, the phone's
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
    const stopDms = startDmEvents();
    const stopActivity = startActivityEvents();
    const stopPresence = startPresenceEvents();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        wakeGateway();
        wakeCall();
      }
    });
    return () => {
      stopServers();
      stopChat();
      stopDms();
      stopActivity();
      stopPresence();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    connectGateway(userId);
  }, [userId]);

  useEffect(() => {
    if (!signedOut) return;
    leaveCall();
    resetServersStore();
    clearTypingTimers();
    resetChatStore();
    resetDmsStore();
    resetActivityStore();
    // What was open and half-typed stays with the account that signed out.
    resetConversation();
    resetDrafts();
    resetRecents();
    resetLibrary();
  }, [signedOut]);
}
