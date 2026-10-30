import DMSidebar from "@/components/chat/DMSidebar";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useShallow } from "zustand/shallow";

/**
 * The phone Messages tab: the DM list as a phone page (48px header, 44px
 * search, grouped-card rows), reachable without switching servers first.
 */
export function MobileMessagesTab({
  onSelectDm,
  onNavigate,
}: {
  onSelectDm: (channelId: string) => void;
  /** Leaves the home surface for the conversation view. */
  onNavigate: () => void;
}) {
  const { activeChannelId, activeServerId, dmHomeView } = useChatStore(
    useShallow((s) => ({
      activeChannelId: s.activeChannelId,
      activeServerId: s.activeServerId,
      dmHomeView: s.dmHomeView,
    })),
  );
  const { dispatch } = useChatActions();

  const showDmHome = (view: "friends" | "shop") => {
    dispatch({ type: "SET_DM_HOME_VIEW", view });
    dispatch({ type: "SET_ACTIVE_SERVER", serverId: "@me" });
    dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: null });
    onNavigate();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-ply-0">
      <DMSidebar
        variant="phone"
        activeChannelId={activeServerId === "@me" ? activeChannelId : null}
        activeView={dmHomeView}
        onSelectDm={onSelectDm}
        onShowFriends={() => showDmHome("friends")}
        onShowShop={() => showDmHome("shop")}
      />
    </div>
  );
}
