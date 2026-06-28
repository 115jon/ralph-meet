import { getDisplayInitial } from "@/lib/display-name";
import { IconButton } from "@/components/ui/IconButton";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Notification as AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Bell, Hash, X } from "./Icons";

// ── Notification Bell — toolbar icon + dropdown ─────────────────────────────

export const NotificationBell = memo(function NotificationBell() {
  const unreadCount = useChatStore(s => s.unreadNotificationCount);
  const notifications = useChatStore(s => s.notifications);
  const { loadNotifications, markNotificationsRead } = useChatActions();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const loadedRef = useRef(false);

  // Load notifications on first open
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadNotifications();
      loadedRef.current = true;
    }
  }, [open, loadNotifications]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey, { capture: true });
    };
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const handleMarkAllRead = useCallback(() => {
    markNotificationsRead();
  }, [markNotificationsRead]);

  const handleNotificationClick = useCallback(
    (notif: AppNotification) => {
      // Mark as read
      if (!notif.is_read) {
        markNotificationsRead([notif.id]);
      }
      // Navigate to the channel/message
      if (notif.channel_id && notif.message_id) {
        window.dispatchEvent(
          new CustomEvent("navigate-channel", {
            detail: {
              channelId: notif.channel_id,
              messageId: notif.message_id,
              serverId: notif.server_id,
            },
          })
        );
      }
      setOpen(false);
    },
    [markNotificationsRead]
  );

  return (
    <div className="relative">
      {/* Bell icon */}
      <button
        ref={buttonRef}
        className="group relative flex h-6 w-6 cursor-pointer items-center justify-center transition-all hover:bg-rm-bg-hover rounded-md"
        title="Notifications"
        onClick={toggle}
      >
        <Bell
          className={cn(
            "h-[14px] w-[14px] transition-colors",
            open
              ? "text-rm-accent"
              : "text-rm-text-muted group-hover:text-rm-text"
          )}
        />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white leading-none animate-in zoom-in duration-200">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="fixed inset-0 z-50 md:absolute md:inset-auto md:right-0 md:top-8 md:w-80 md:max-h-112 flex flex-col items-center justify-end md:justify-start pointer-events-none">
          {/* Mobile backdrop overlay */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px] md:hidden pointer-events-auto animate-in fade-in duration-300"
            onClick={() => setOpen(false)}
            role="presentation"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />

          <div
            ref={panelRef}
            className="relative w-full h-[85vh] md:h-auto max-h-[85vh] md:max-h-full flex flex-col rounded-t-[20px] md:rounded-lg border border-rm-border bg-rm-bg-surface shadow-2xl animate-in slide-in-from-bottom-full md:slide-in-from-top-1 md:fade-in duration-300 md:duration-200 pointer-events-auto mt-auto md:mt-0"
          >
            {/* Mobile drag handle */}
            <div className="w-full flex justify-center pt-3 pb-1 md:hidden">
              <div className="w-12 h-1.5 rounded-full bg-rm-bg-hover" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 md:px-3 py-3 md:py-2.5 border-b border-rm-border">
              <h3 className="text-[15px] md:text-[13px] font-bold text-rm-text-primary tracking-tight">
                Inbox
              </h3>
              <div className="flex items-center gap-3 md:gap-2">
                {unreadCount > 0 && (
                  <button
                    className="text-[11px] font-semibold text-rm-accent hover:opacity-80 transition-colors"
                    onClick={handleMarkAllRead}
                  >
                    Mark all read
                  </button>
                )}
                <IconButton icon={X} size="xs" className="md:h-5 md:w-5" onClick={() => setOpen(false)} />
              </div>
            </div>

            {/* Notification list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pb-6 md:pb-0">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Bell className="h-8 w-8 text-rm-text-muted opacity-40" />
                  <p className="text-[12px] font-medium text-rm-text-muted">
                    No notifications yet
                  </p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <NotificationRow
                    key={notif.id}
                    notification={notif}
                    onClick={handleNotificationClick}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Individual notification row ──────────────────────────────────────────────

const NotificationRow = memo(function NotificationRow({
  notification,
  onClick,
}: {
  notification: AppNotification;
  onClick: (n: AppNotification) => void;
}) {
  const label =
    notification.type === "mention"
      ? "mentioned you"
      : notification.type === "reply"
        ? "replied to you"
        : "sent a message";

  const authorInfo = useUserResolution(notification.from_user?.id, notification.from_user);
  const timeAgo = getTimeAgo(notification.created_at);

  return (
    <button
      className={cn(
        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-rm-bg-hover border-b border-rm-border/50 last:border-0",
        !notification.is_read && "bg-rm-accent/5"
      )}
      onClick={() => onClick(notification)}
    >
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        {authorInfo.avatarUrl ? (
          <img
            src={getAuthAssetUrl(authorInfo.avatarUrl)}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rm-accent/20 text-[11px] font-bold text-rm-accent">
            {getDisplayInitial({ display_name: authorInfo.displayName, username: authorInfo.username })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] leading-tight">
          <span className="font-semibold text-rm-text-primary">
            {authorInfo.displayName}
          </span>{" "}
          <span className="text-rm-text-muted">{label}</span>
        </p>

        {/* Channel + server context (skip for DMs — sender name is already shown above) */}
        {notification.type !== "dm" && (
          <div className="flex items-center gap-1 mt-0.5">
            <Hash className="h-2.5 w-2.5 text-rm-text-muted opacity-60" />
            <span className="text-[10px] text-rm-text-muted truncate">
              {notification.channel_name ?? "channel"}
              {notification.server_name && ` · ${notification.server_name}`}
            </span>
          </div>
        )}

        {/* Message snippet */}
        {notification.content && (
          <p className="mt-1 text-[11px] text-rm-text-muted/80 line-clamp-2 leading-relaxed">
            {notification.content}
          </p>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-rm-text-muted/50 mt-1 block">
          {timeAgo}
        </span>
      </div>

      {/* Unread dot */}
      {!notification.is_read && (
        <div className="shrink-0 mt-2">
          <div className="h-2 w-2 rounded-full bg-rm-accent" />
        </div>
      )}
    </button>
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTimeAgo(isoStr: string): string {
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(isoStr).toLocaleDateString();
}
