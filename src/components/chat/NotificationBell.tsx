import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { IconButton } from "@/components/ui/IconButton";
import { CountBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { MENU_PANEL } from "@/components/ui/menu";
import { PickerSurface } from "./PickerSurface";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
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
      {/* Bell: the header's one count badge, top-right, cut from ply-0. */}
      <IconButton
        ref={buttonRef}
        icon="bell"
        variant="muted"
        size={40}
        tone={open ? "toggled" : "idle"}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
        onClick={toggle}
      />
      {unreadCount > 0 && (
        <CountBadge
          count={unreadCount}
          ring="ply-0"
          className="pointer-events-none absolute top-0.5 right-0.5"
        />
      )}

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

  const labelId = useId();

  return (
    <>
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 px-4",
          page
            ? "h-[calc(48px+var(--safe-area-top,0px))] pt-[var(--safe-area-top,0px)]"
            : "h-12 border-b border-line",
        )}
      >
        <h2 className="min-w-0 truncate text-ui-md font-semibold text-ink-1">
          {page ? "Notifications" : "Inbox"}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {unreadCount > 0 && (
            <Button
              type="button"
              variant={page ? "secondary" : "link"}
              size={page ? "md" : "xs"}
              onClick={() => markNotificationsRead()}
            >
              Mark all read
            </Button>
          )}
          {onClose ? (
            <IconButton
              aria-label="Close notifications"
              icon="close"
              size={28}
              variant="muted"
              onClick={onClose}
            />
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-6 md:pb-0">
        {notifications.length === 0 ? (
          <EmptyState
            size="sm"
            className="py-10"
            title="No notifications yet"
            description="Mentions and replies show up here."
          />
        ) : page ? (
          // Phone list grammar (shared with MobileYouPage): one sentence-case
          // label over an inset grouped card, rows split by hairlines.
          <section aria-labelledby={labelId}>
            <h3
              id={labelId}
              className="px-4 pb-2 pt-2 text-ui-xs font-semibold text-ink-2"
            >
              Recent
            </h3>
            <ul className="mx-4 overflow-hidden rounded-lg border border-line bg-ply-2 divide-y divide-line">
              {notifications.map((notif) => (
                <li key={notif.id}>
                  <NotificationRow
                    notification={notif}
                    onClick={handleNotificationClick}
                    roomy
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <ul className="divide-y divide-line">
            {notifications.map((notif) => (
              <li key={notif.id}>
                <NotificationRow
                  notification={notif}
                  onClick={handleNotificationClick}
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

  const unread = !notification.is_read;

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-3 px-4 text-left outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1 active:bg-tint-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        roomy ? "min-h-14 py-3" : "py-3",
        // The panel keeps the mention tint; the phone page marks unread with
        // the dot alone.
        unread && !roomy && "bg-accent-tint",
      )}
      onClick={() => onClick(notification)}
    >
      {/* Avatar: AvatarImage honours the member's crop; Avatar is the
          initial fallback. */}
      <div className="mt-0.5 shrink-0">
        {authorInfo.avatarUrl ? (
          <span
            aria-hidden="true"
            className={cn(
              "relative flex bg-ply-2",
              avatarShape(authorInfo.avatarDisplay),
              roomy ? "size-10" : "size-8",
            )}
          >
            <AvatarImage
              src={getAuthAssetUrl(authorInfo.avatarUrl)}
              alt=""
              display={authorInfo.avatarDisplay}
            />
          </span>
        ) : (
          <Avatar
            name={authorInfo.displayName || authorInfo.username || "?"}
            size={roomy ? 40 : 32}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-ui-row">
            <span
              className={cn(
                unread ? "font-semibold text-ink-1" : "font-medium text-ink-2",
              )}
            >
              <InlineEmojiText text={authorInfo.displayName} />
            </span>{" "}
            <span
              className={cn(
                "font-normal",
                unread ? "text-ink-2" : "text-ink-3",
              )}
            >
              {label}
            </span>
          </p>
          <Num className="shrink-0 text-ink-3">
            {timeAgo === "just now" ? "now" : timeAgo.replace(/ ago$/, "")}
            <span className="sr-only">
              {timeAgo.endsWith(" ago") ? " ago" : ""}
            </span>
          </Num>
          {unread && (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 self-center rounded-full bg-accent-ink"
              />
              <span className="sr-only">Unread</span>
            </>
          )}
        </div>

        {/* Channel + server context (skip for DMs: the sender is already named above) */}
        {notification.type !== "dm" && (
          <div className="mt-0.5 flex items-center gap-1">
            <Icon
              name="textChannel"
              size="xs"
              className="shrink-0 text-ink-3"
            />
            <span className="truncate text-ui-xs text-ink-3">
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
          <p className="mt-1 line-clamp-2 text-ui-sm text-pretty text-ink-2">
            <InlineEmojiText text={notification.content} />
          </p>
        )}
      </div>
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
  // "Oct 22" (the year only when it differs): a full numeric date ate the
  // row's name and action on phones.
  const date = new Date(isoStr);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  });
}
