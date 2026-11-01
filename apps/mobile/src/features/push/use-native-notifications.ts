import { Schema } from "effect";
import { useEffect } from "react";
import { AppState } from "react-native";

import { useSession } from "@/features/auth/session";
import { useChatStore } from "@/features/chat/store";
import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch } from "@/features/realtime/gateway";
import { mediaUrl } from "@/lib/api";
import { config } from "@/lib/config";

import * as RalphNotify from "../../../modules/ralph-notify/src";

const decodeReadState = eventDecoder(
  Schema.Struct({ channel_id: Schema.String }),
);

/**
 * Keeps modules/ralph-notify in step with the app: the session it needs
 * with the app killed (mirrored on sign-in, wiped with every notification
 * on sign-out), the conversation on screen (whose pushes stay quiet and
 * whose notification goes), and conversations read on any device
 * (READ_STATE_UPDATE over the gateway; the server's read push covers the
 * app being closed).
 */
export function useNativeNotifications(): void {
  const token = useSession((s) => s.token);
  const signedOut = useSession((s) => s.status === "signed-out");
  const user = useSession((s) => s.user);

  useEffect(() => {
    if (!RalphNotify.isAvailable || !token || !user) return;
    RalphNotify.setSession({
      token,
      apiBaseUrl: config.apiBaseUrl,
      userId: user.id,
      userName: user.display_name?.trim() || user.username,
      userAvatar: mediaUrl(user.avatar_url),
      scheme: config.scheme,
    });
  }, [token, user]);

  useEffect(() => {
    if (signedOut) RalphNotify.clearSession();
  }, [signedOut]);

  useEffect(() => {
    if (!RalphNotify.isAvailable) return;
    const sync = () => {
      const open =
        AppState.currentState === "active"
          ? useChatStore.getState().openChannelId
          : null;
      RalphNotify.setActiveConversation(open);
      if (open) RalphNotify.clearConversation(open);
    };
    sync();
    const offChat = useChatStore.subscribe((s, previous) => {
      if (s.openChannelId !== previous.openChannelId) sync();
    });
    const offApp = AppState.addEventListener("change", sync);
    const offRead = onDispatch((event, data) => {
      if (event !== "READ_STATE_UPDATE") return;
      const read = decodeReadState(data);
      if (read) RalphNotify.clearConversation(read.channel_id);
    });
    return () => {
      offChat();
      offApp.remove();
      offRead();
    };
  }, []);
}
