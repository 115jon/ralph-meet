import { getDisplayInitial } from "@/lib/display-name";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { useUserResolution } from "@/hooks/useUserResolution";
import {
  getDesktopNotificationBadgeState,
  getUnreadDocumentTitle,
} from "@/lib/desktop-notifications";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Notification as AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { MENU_PANEL } from "@/components/ui/menu";
import { PickerSurface } from "./PickerSurface";
import { AvatarImage } from "./AvatarImage";
import { Icon } from "@/components/ui/icon";
import InlineEmojiText from "./InlineEmojiText";

// ── Notification Bell — toolbar icon + inbox panel ──────────────────────────

/** Gap between the bell and the panel, and the panel's viewport margin. */
const PANEL_GAP = 8;

type PanelPosition = { top: number; right: number };

function measurePanelPosition(button: HTMLElement | null): PanelPosition {
  if (!button) return { top: 56, right: PANEL_GAP };
  const rect = button.getBoundingClientRect();
  return {
    top: Math.round(rect.bottom + PANEL_GAP),
    right: Math.max(PANEL_GAP, Math.round(window.innerWidth - rect.right)),
  };
}

export const NotificationBell = memo(function NotificationBell() {
  const unreadCount = useChatStore((s) => s.unreadNotificationCount);
  const notifications = useChatStore((s) => s.notifications);
  const { loadNotifications } = useChatActions();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const loadedRef = useRef(false);
  const baseTitleRef = useRef<string | null>(null);
  // A click elsewhere closes the panel and leaves focus where it landed;
  // Escape, back and the close button return focus to the bell.
  const interactedOutsideRef = useRef(false);

  // Load notifications on first open
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadNotifications();
      loadedRef.current = true;
    }
  }, [open, loadNotifications]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (baseTitleRef.current === null) {
      baseTitleRef.current = document.title || "Ralph Meet";
    }

    const badge = getDesktopNotificationBadgeState({ notifications });
    document.title = getUnreadDocumentTitle(baseTitleRef.current, badge);

    return () => {
      if (baseTitleRef.current !== null) {
        document.title = baseTitleRef.current;
      }
    };
  }, [notifications]);

  // Keep the panel under the bell when the window resizes.
  useEffect(() => {
    if (!open) return;
    const update = () => setPosition(measurePanelPosition(buttonRef.current));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  const toggle = useCallback(() => {
    if (!open) {
      interactedOutsideRef.current = false;
      setPosition(measurePanelPosition(buttonRef.current));
    }
    setOpen(!open);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const panelStyle: CSSProperties | undefined = position
    ? {
        top: position.top,
        right: position.right,
        maxHeight: `min(560px, calc(100dvh - ${position.top + PANEL_GAP}px))`,
      }
    : undefined;

  return (
    <div className="relative">
      {/* Bell icon */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        ref={buttonRef}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          open
            ? "bg-rm-tint-2 text-rm-text"
            : "text-rm-text-muted pointer-fine:hover:text-rm-text",
        )}
        title="Notifications"
        onClick={toggle}
      >
        <Icon name="bell" state={open ? "active" : "idle"} size="lg" />
        {unreadCount > 0 && (
          <span className="badge-count absolute -top-1 -right-1 ring-2 ring-rm-bg-primary animate-in zoom-in-90 duration-200">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {/*
       * Desktop: a non-modal panel anchored under the bell. Phones: the
       * picker drawer (the bell is hidden in the phone header and the inbox
       * lives in the Notifications tab, but the drawer still works).
       */}
      <PickerSurface
        open={open}
        onOpenChange={setOpen}
        modal={false}
        onBackButton={close}
        ariaLabel="Notifications"
        desktopProps={{
          onInteractOutside: (event) => {
            const target = event.target;
            if (target instanceof Node && buttonRef.current?.contains(target)) {
              // The bell toggles the panel itself; closing here first would
              // let its click reopen it.
              event.preventDefault();
              return;
            }
            interactedOutsideRef.current = true;
          },
          onCloseAutoFocus: (event) => {
            if (interactedOutsideRef.current) event.preventDefault();
          },
        }}
        className={cn(
          MENU_PANEL,
          "fixed z-50 m-0 flex w-[min(380px,calc(100vw-16px))] origin-top-right flex-col overflow-hidden p-0 outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-180",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=closed]:duration-120",
        )}
        style={panelStyle}
      >
        <NotificationInbox onClose={close} />
      </PickerSurface>
    </div>
  );
});

// ── Inbox: header + list, shared by the bell and the mobile tab ────────────

export function NotificationInbox({
  onClose,
  onNavigate,
  variant = "panel",
}: {
  /** Shows a close button in the header. */
  onClose?: () => void;
  /** Called after a notification row navigates (the bell closes itself). */
  onNavigate?: () => void;
  /** `page` is the full-height mobile tab: larger title, no close button. */
  variant?: "panel" | "page";
}) {
  const unreadCount = useChatStore((s) => s.unreadNotificationCount);
  const notifications = useChatStore((s) => s.notifications);
  const { markNotificationsRead } = useChatActions();
  const page = variant === "page";

  const handleNotificationClick = useCallback(
    (notif: AppNotification) => {
      if (!notif.is_read) {
        markNotificationsRead([notif.id]);
      }
      if (notif.channel_id && notif.message_id) {
        window.dispatchEvent(
          new CustomEvent("navigate-channel", {
            detail: {
              channelId: notif.channel_id,
              messageId: notif.message_id,
              serverId: notif.server_id,
            },
          }),
        );
      }
      onNavigate?.();
      onClose?.();
    },
    [markNotificationsRead, onClose, onNavigate],
  );

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-rm-border px-4">
        <h2 className="min-w-0 truncate text-ui-md font-semibold text-rm-text">
          {page ? "Notifications" : "Inbox"}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {unreadCount > 0 && (
            <Button
              type="button"
              variant={page ? "secondary" : "link"}
              size={page ? "sm" : "xs"}
              className={page ? undefined : "text-ui-2xs"}
              onClick={() => markNotificationsRead()}
            >
              Mark all read
            </Button>
          )}
          {onClose ? (
            <IconButton
              aria-label="Close notifications"
              icon="close"
              size="sm"
              variant="muted"
              onClick={onClose}
            />
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar pb-6 md:pb-0">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <Icon
              name="bell"
              size="2xl"
              className="text-rm-text-muted opacity-40"
            />
            <p className="text-ui-xs font-medium text-rm-text-muted">
              No notifications yet
            </p>
            {page ? (
              <p className="text-ui-xs text-rm-text-muted">
                Mentions and replies show up here.
              </p>
            ) : null}
          </div>
        ) : (
          <ul>
            {notifications.map((notif) => (
              <li key={notif.id}>
                <NotificationRow
                  notification={notif}
                  onClick={handleNotificationClick}
                  roomy={page}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ── Individual notification row ──────────────────────────────────────────────

const NotificationRow = memo(function NotificationRow({
  notification,
  onClick,
  roomy = false,
}: {
  notification: AppNotification;
  onClick: (n: AppNotification) => void;
  /** Touch spacing for the full-page inbox. */
  roomy?: boolean;
}) {
  const label =
    notification.type === "mention"
      ? "mentioned you"
      : notification.type === "reply"
        ? "replied to you"
        : "sent a message";

  const authorInfo = useUserResolution(
    notification.from_user?.id,
    notification.from_user,
  );
  const timeAgo = getTimeAgo(notification.created_at);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-2.5 text-left transition-colors duration-150 pointer-fine:hover:bg-rm-bg-hover active:bg-rm-bg-hover border-b border-rm-border/50",
        roomy ? "min-h-16 px-4 py-3" : "px-3 py-2.5",
        !notification.is_read && "bg-rm-accent-tint",
      )}
      onClick={() => onClick(notification)}
    >
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        {authorInfo.avatarUrl ? (
          <div className="size-10 overflow-visible rounded-full">
            <AvatarImage
              src={getAuthAssetUrl(authorInfo.avatarUrl)}
              alt=""
              display={authorInfo.avatarDisplay}
            />
          </div>
        ) : (
          <div className="flex size-10 items-center justify-center rounded-full bg-rm-accent-tint text-ui-sm font-semibold text-rm-accent-ink">
            {getDisplayInitial({
              display_name: authorInfo.displayName,
              username: authorInfo.username,
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-ui-xs leading-tight">
          <span className="font-semibold text-rm-text-primary">
            <InlineEmojiText text={authorInfo.displayName} />
          </span>{" "}
          <span className="text-rm-text-muted">{label}</span>
        </p>

        {/* Channel + server context (skip for DMs — sender name is already shown above) */}
        {notification.type !== "dm" && (
          <div className="flex items-center gap-1 mt-0.5">
            <Icon
              name="textChannel"
              size="xs"
              className="text-rm-text-muted opacity-60"
            />
            <span className="text-ui-2xs text-rm-text-muted truncate">
              <InlineEmojiText
                text={`${notification.channel_name ?? "channel"}${
                  notification.server_name
                    ? ` · ${notification.server_name}`
                    : ""
                }`}
              />
            </span>
          </div>
        )}

        {/* Message snippet */}
        {notification.content && (
          <p className="mt-1 text-ui-2xs text-rm-text-secondary line-clamp-2 leading-relaxed">
            <InlineEmojiText text={notification.content} />
          </p>
        )}

        {/* Timestamp */}
        <span className="text-ui-2xs text-rm-text-muted mt-1 block">
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
