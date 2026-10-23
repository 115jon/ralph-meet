import { Icon, type StatefulIconName } from "@/components/ui/icon";
import { PRESS } from "@/components/ui/interaction";
import { useSoftKeyboardOpen } from "@/hooks/useSoftKeyboardOpen";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { type MobileTab, useMobileTabStore } from "@/stores/useMobileTabStore";
import { useShallow } from "zustand/shallow";

const TABS: ReadonlyArray<{
  id: MobileTab;
  label: string;
  icon: StatefulIconName;
}> = [
  { id: "servers", label: "Servers", icon: "home" },
  { id: "messages", label: "Messages", icon: "chat" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "you", label: "You", icon: "account" },
];

function useUnreadDmCount() {
  return useChatStore(
    useShallow((s) => {
      let count = 0;
      for (const dm of s.dmChannels) {
        const last = s.lastMessageAt[dm.id];
        if (!last) continue;
        const read = s.readStates[dm.id];
        if (!read || last > read) count += 1;
      }
      return count;
    }),
  );
}

function formatBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}

/**
 * Phone home navigation, Discord style. Lives at the bottom of the mobile home
 * surface, so it is gone inside a conversation by construction, and it steps
 * aside while the on-screen keyboard is up. Active tab draws its glyph in Fill.
 */
export function MobileTabBar({ className }: { className?: string }) {
  const tab = useMobileTabStore((s) => s.tab);
  const setTab = useMobileTabStore((s) => s.setTab);
  const keyboardOpen = useSoftKeyboardOpen();
  const unreadDms = useUnreadDmCount();
  const unreadNotifications = useChatStore((s) => s.unreadNotificationCount);

  if (keyboardOpen) return null;

  const badges: Partial<Record<MobileTab, number>> = {
    messages: unreadDms,
    notifications: unreadNotifications,
  };

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "shrink-0 border-t border-rm-border bg-rm-bg-secondary pb-[var(--safe-area-bottom,0px)]",
        className,
      )}
    >
      <ul className="flex h-14 items-stretch">
        {TABS.map((item) => {
          const active = item.id === tab;
          const badge = badges[item.id] ?? 0;
          return (
            <li key={item.id} className="flex min-w-0 flex-1">
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                aria-label={
                  badge > 0
                    ? `${item.label}, ${badge === 1 ? "1 unread" : `${formatBadge(badge)} unread`}`
                    : item.label
                }
                data-tab={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg outline-offset-[-4px] [--hover-o:0] [--press-o:0.06]",
                  PRESS,
                  active ? "text-rm-text" : "text-rm-text-muted",
                )}
              >
                <span className="relative">
                  <Icon
                    name={item.icon}
                    state={active ? "active" : "idle"}
                    size="xl"
                  />
                  {badge > 0 ? (
                    <span
                      aria-hidden="true"
                      className="badge-count absolute -top-1 left-1/2 ml-1.5 ring-2 ring-rm-bg-secondary"
                    >
                      {formatBadge(badge)}
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "max-w-full truncate px-1 text-ui-2xs",
                    active ? "font-semibold" : "font-medium",
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
