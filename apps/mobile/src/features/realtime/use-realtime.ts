import { useEffect } from "react";
import { AppState } from "react-native";

import { startActivityEvents } from "@/features/activity/realtime";
import { resetActivityStore } from "@/features/activity/store";
import { useSession } from "@/features/auth/session";
import { startCallEvents } from "@/features/calls/actions";
import { resetCallsStore } from "@/features/calls/store";
import { clearTypingTimers } from "@/features/chat/actions";
import { startChatEvents } from "@/features/chat/realtime";
import { resetDrafts } from "@/features/chat/drafts";
import { resetLibrary } from "@/features/chat/picker/library";
import { resetRecents } from "@/features/chat/picker/recents";
import { resetChatStore } from "@/features/chat/store";
import { resetConversation } from "@/features/conversation/store";
import { startDmEvents } from "@/features/dms/realtime";
import { resetDmsStore } from "@/features/dms/store";
import { startFriendEvents } from "@/features/friends/realtime";
import { resetFriendsStore } from "@/features/friends/store";
import { startMemberEvents } from "@/features/members/realtime";
import { resetMembersStore } from "@/features/members/store";
import { resetLivePresence } from "@/features/presence/live";
import { startPresenceEvents } from "@/features/presence/realtime";
import { startProfileEvents } from "@/features/profile/realtime";
import { resetProfiles } from "@/features/profile/store";
import { startServerEvents } from "@/features/servers/realtime";
import { resetServersStore } from "@/features/servers/store";
import { resetShare } from "@/features/share/store";
import { leaveCall, wakeCall } from "@/features/voice/actions";

import { addNetworkChangeListener } from "../../../modules/ralph-network/src";
import { connectGateway, wakeGateway } from "./gateway";
import { createNetworkWake } from "./network-wake";

/**
 * Runs the chat socket while signed in: connects once the profile (the
 * Identify user id) is known, drops it and everything cached (servers,
 * messages, DMs, members, friends, activity, the call) on sign-out, and wakes it when the app returns to the front, the phone's
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
    const stopMembers = startMemberEvents();
    const stopFriends = startFriendEvents();
    const stopProfiles = startProfileEvents();
    const stopCalls = startCallEvents();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        wakeGateway();
        wakeCall();
      }
    });
    // The default network changed; the HTTP pool was reset natively before
    // this fired. Back after a loss, every socket from before is dead, so
    // reconnect now (resuming the call) instead of waiting out a backoff or
    // a probe; a switch with no loss probes. Runs in the background too.
    const stopNetwork = addNetworkChangeListener(
      createNetworkWake((networkChanged) => {
        wakeGateway({ networkChanged });
        wakeCall({ networkChanged });
      }),
    );
    return () => {
      stopServers();
      stopChat();
      stopDms();
      stopActivity();
      stopPresence();
      stopMembers();
      stopFriends();
      stopProfiles();
      stopCalls();
      appState.remove();
      stopNetwork();
    };
  }, []);

  useEffect(() => {
    connectGateway(userId);
  }, [userId]);

  useEffect(() => {
    if (!signedOut) return;
    leaveCall();
    resetCallsStore();
    resetServersStore();
    clearTypingTimers();
    resetChatStore();
    resetDmsStore();
    resetMembersStore();
    resetFriendsStore();
    resetLivePresence();
    resetProfiles();
    resetActivityStore();
    // What was open and half-typed stays with the account that signed out.
    resetConversation();
    resetDrafts();
    resetRecents();
    resetLibrary();
    resetShare();
  }, [signedOut]);
}
