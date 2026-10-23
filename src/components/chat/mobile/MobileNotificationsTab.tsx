import { NotificationInbox } from "@/components/chat/NotificationBell";
import { useChatActions } from "@/stores/chat-store";
import { useEffect } from "react";

/** The phone Notifications tab: the bell's inbox as a full page. */
export function MobileNotificationsTab({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const { loadNotifications } = useChatActions();

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-rm-bg-primary">
      <NotificationInbox variant="page" onNavigate={onNavigate} />
    </div>
  );
}
