import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import InlineEmojiText from "@/components/chat/InlineEmojiText";
import {
  ProfileCard,
  resolveProfileCardTheme,
} from "@/components/chat/ProfileCard";
import {
  UserStatusDot,
  type UserStatus,
} from "@/components/chat/UserStatusDot";
import { lastInputWasKeyboard } from "@/components/ui/dialog-stack";
import { Icon } from "@/components/ui/icon";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_LABEL,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import { ResponsivePopover } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/useMediaQuery";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

interface Props {
  user: User;
  onClose: () => void;
  updateStatus: (status: UserStatus, custom_status?: string | null) => void;
  onOpenProfileEditor: (trigger?: HTMLElement) => void;
  anchorEl: HTMLElement;
  /** @deprecated The popover animates itself; kept for existing callers. */
  isClosing?: boolean;
  /** Open on the status submenu (fixtures). */
  initialView?: "main" | "status";
}

const STATUS_OPTIONS = [
  { value: "online" as const, label: "Online" },
  { value: "idle" as const, label: "Idle" },
  { value: "dnd" as const, label: "Do not disturb" },
  { value: "offline" as const, label: "Invisible" },
];

const CUSTOM_STATUS_PLACEHOLDER = "Set a custom status";

const ROW = cn(MENU_ITEM, MENU_ITEM_DEFAULT);

/**
 * Menu keyboard model for the rows (role="menu"): arrows, Home/End and
 * typeahead move focus between items; Tab leaves the menu.
 */
function useMenuKeys({
  onForward,
  onBack,
}: {
  /** ArrowRight on an item with a submenu view. */
  onForward?: (item: HTMLElement) => boolean;
  /** ArrowLeft (back out of a submenu view). */
  onBack?: () => void;
}) {
  const typeahead = useRef({ text: "", at: 0 });
  return (event: KeyboardEvent<HTMLElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowRight" && current >= 0 && onForward) {
      if (onForward(items[current]!)) event.preventDefault();
      return;
    } else if (event.key === "ArrowLeft" && onBack) {
      event.preventDefault();
      onBack();
      return;
    } else if (
      event.key.length === 1 &&
      event.key.trim() &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      const state = typeahead.current;
      state.text = now - state.at > 500 ? event.key : state.text + event.key;
      state.at = now;
      const query = state.text.toLowerCase();
      const ordered = [
        ...items.slice(current + 1),
        ...items.slice(0, current + 1),
      ];
      const match = ordered.find((item) =>
        (item.textContent ?? "").trim().toLowerCase().startsWith(query),
      );
      if (match) next = items.indexOf(match);
    }
    if (next >= 0) {
      event.preventDefault();
      items[next]!.focus();
    }
  };
}

function MenuRow({
  icon,
  label,
  onClick,
  trailing,
  buttonRef,
  first = false,
  ...props
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  trailing?: ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** The roving tab stop. */
  first?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      tabIndex={first ? 0 : -1}
      onClick={onClick}
      className={ROW}
      {...props}
    >
      <span aria-hidden="true" className={MENU_ICON}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? (
        <span aria-hidden="true" className="shrink-0 text-ink-3">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

/** The two stacked views share one grid cell, so the height never jumps. */
const VIEW =
  "col-start-1 row-start-1 flex flex-col transition-[opacity,translate] ease-out";
const VIEW_ON = "opacity-100 translate-x-0 duration-(--dur-2) delay-75";
const VIEW_OFF = "pointer-events-none opacity-0 duration-75";

export default function UserAccountPopover({
  user,
  onClose,
  updateStatus,
  onOpenProfileEditor,
  anchorEl,
  initialView = "main",
}: Props) {
  const isMobile = useIsMobile();
  const currentUser = useChatStore((state) =>
    state.user?.id === user.id ? state.user : null,
  );
  const profileUser = currentUser
    ? {
        ...user,
        avatar_display: currentUser.avatar_display ?? user.avatar_display,
      }
    : user;
  const [showStatusMenu, setShowStatusMenu] = useState(
    initialView === "status",
  );
  const [isEditingCustomStatus, setIsEditingCustomStatus] = useState(false);
  const [customStatusInput, setCustomStatusInput] = useState(
    user.custom_status || "",
  );
  // Read once, at open: keyboard opens focus the first row.
  const [openedByKeyboard] = useState(() => lastInputWasKeyboard());
  const statusRowRef = useRef<HTMLButtonElement>(null);
  const statusBackRef = useRef<HTMLButtonElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const viewChangedRef = useRef(false);

  const currentStatus = user.status ?? "online";
  const displayName = user.display_name?.trim() || user.username;
  const theme = resolveProfileCardTheme(user);
  const currentStatusLabel =
    STATUS_OPTIONS.find((option) => option.value === currentStatus)?.label ??
    "Online";
  const customStatus = user.custom_status?.trim() ?? "";

  useEffect(() => {
    if (!isEditingCustomStatus) {
      const timeout = setTimeout(
        () => setCustomStatusInput(user.custom_status || ""),
        0,
      );
      return () => clearTimeout(timeout);
    }
  }, [user.custom_status, isEditingCustomStatus]);

  // Focus follows the view it just switched to.
  useEffect(() => {
    if (!viewChangedRef.current) return;
    viewChangedRef.current = false;
    (showStatusMenu ? statusBackRef : statusRowRef).current?.focus();
  }, [showStatusMenu]);

  const switchView = (status: boolean) => {
    viewChangedRef.current = true;
    setShowStatusMenu(status);
  };

  const mainKeys = useMenuKeys({
    onForward: (item) => {
      if (item !== statusRowRef.current) return false;
      switchView(true);
      return true;
    },
  });
  const statusKeys = useMenuKeys({ onBack: () => switchView(false) });

  const handleCustomStatusSave = () => {
    const value = customStatusInput.trim();

    if (value !== (user.custom_status || "")) {
      updateStatus(currentStatus, value || undefined);
    }

    setIsEditingCustomStatus(false);
  };

  // The custom status sits under the name as a 13px row (overlays §4).
  const statusLine = isEditingCustomStatus ? (
    <input
      type="text"
      className="h-8 w-full rounded-md border border-line-field bg-ply-2 px-2.5 text-ui-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-(--focus)"
      aria-label="Custom status"
      value={customStatusInput}
      onChange={(event) => setCustomStatusInput(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") handleCustomStatusSave();
        if (event.key === "Escape") {
          // Cancel the edit; the popover stays open.
          event.stopPropagation();
          setCustomStatusInput(user.custom_status || "");
          setIsEditingCustomStatus(false);
        }
      }}
      onBlur={handleCustomStatusSave}
      placeholder={CUSTOM_STATUS_PLACEHOLDER}
      maxLength={128}
      autoFocus
    />
  ) : (
    <button
      type="button"
      aria-label="Edit custom status"
      onClick={() => setIsEditingCustomStatus(true)}
      className="-mx-1.5 flex h-7 min-w-0 items-center gap-1.5 self-start rounded-sm px-1.5 text-left text-ui-sm outline-none pointer-fine:hover:bg-tint-1 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-(--focus)"
    >
      <Icon
        name={customStatus ? "emoji" : "add"}
        size="sm"
        className="shrink-0 text-ink-3"
      />
      <span
        className={cn(
          "min-w-0 truncate",
          customStatus ? "text-ink-1" : "text-ink-3",
        )}
      >
        {customStatus ? (
          <InlineEmojiText text={customStatus} />
        ) : (
          CUSTOM_STATUS_PLACEHOLDER
        )}
      </span>
    </button>
  );

  return (
    <ResponsivePopover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="User account options"
      anchor={anchorEl}
      side="top"
      align="start"
      sideOffset={8}
      collisionPadding={12}
      variant="panel"
      // Pointer opens land on the surface (no ring); keyboard opens on the
      // first row of the current view.
      initialFocus={() => {
        const row = (showStatusMenu ? statusBackRef : firstRowRef).current;
        return openedByKeyboard
          ? row
          : (row?.closest<HTMLElement>('[data-slot="popover-content"]') ??
              true);
      }}
      // The profile card is the panel: it carries the radius, line and
      // shadow, and its frame art may overhang the edge.
      className="overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none"
    >
      <ProfileCard
        size="popover"
        user={profileUser}
        theme={theme}
        name={displayName}
        statusLine={statusLine}
        className="w-full"
        surfaceClassName={cn(isMobile && "shadow-none")}
        scrollClassName="max-h-[calc(min(620px,var(--available-height,100dvh))-var(--rm-profile-frame-reserve-y,0px))]"
      >
        <div className="-mx-2 -mb-2 grid">
          {/* Main view */}
          <div
            role="menu"
            aria-label="Account"
            aria-orientation="vertical"
            inert={showStatusMenu}
            onKeyDown={mainKeys}
            className={cn(
              VIEW,
              showStatusMenu ? VIEW_OFF : VIEW_ON,
              showStatusMenu && "motion-safe:-translate-x-2",
            )}
          >
            <MenuRow
              buttonRef={firstRowRef}
              first
              icon={<Icon name="edit" size="sm" />}
              label="Edit profile"
              onClick={() => {
                onClose();
                onOpenProfileEditor(anchorEl);
              }}
            />
            <MenuRow
              buttonRef={statusRowRef}
              aria-haspopup="menu"
              aria-expanded={showStatusMenu}
              icon={
                <UserStatusDot status={currentStatus} className="size-2.5" />
              }
              label={currentStatusLabel}
              onClick={() => switchView(true)}
              trailing={<Icon name="chevronRight" size="xs" />}
            />
            <div role="separator" className={cn(MENU_SEPARATOR, "mx-1")} />
            <MenuRow
              icon={<Icon name="copyId" size="sm" />}
              label="Copy user ID"
              onClick={() => {
                void navigator.clipboard?.writeText(user.id);
                onClose();
              }}
            />
          </div>

          {/* Status view */}
          <div
            role="menu"
            aria-label="Status"
            aria-orientation="vertical"
            inert={!showStatusMenu}
            onKeyDown={statusKeys}
            className={cn(
              VIEW,
              showStatusMenu ? VIEW_ON : VIEW_OFF,
              !showStatusMenu && "motion-safe:translate-x-2",
            )}
          >
            <button
              ref={statusBackRef}
              type="button"
              role="menuitem"
              tabIndex={0}
              aria-label="Back to account options"
              onClick={() => switchView(false)}
              className={cn(ROW, "text-ink-2")}
            >
              <span aria-hidden="true" className={MENU_ICON}>
                <Icon name="chevronLeft" size="sm" />
              </span>
              <span className={cn(MENU_LABEL, "p-0 text-ink-2")}>Status</span>
            </button>
            {STATUS_OPTIONS.map((option) => {
              const selected = currentStatus === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={selected}
                  className={cn(ROW, selected && "bg-tint-1")}
                  onClick={() => {
                    updateStatus(option.value, user.custom_status);
                    switchView(false);
                  }}
                >
                  <span aria-hidden="true" className={MENU_ICON}>
                    <UserStatusDot status={option.value} className="size-2.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {selected ? (
                    <Icon name="check" size="sm" className="shrink-0" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </ProfileCard>
    </ResponsivePopover>
  );
}
