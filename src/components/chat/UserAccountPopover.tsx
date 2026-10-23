import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import {
  UserStatusDot,
  type UserStatus,
} from "@/components/chat/UserStatusDot";
import { IconButton } from "@/components/ui/IconButton";
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
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileTheme } from "@/lib/profile-customization";
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
  { value: "dnd" as const, label: "Do Not Disturb" },
  {
    value: "offline" as const,
    label: "Invisible",
  },
];

const CUSTOM_STATUS_PLACEHOLDER = "Set a custom status";

/** Menu rows on the profile surface keep the profile's own ink. */
const ROW = cn(
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  "text-[color:var(--rm-profile-custom-text)]",
);
const ROW_ICON = cn(
  MENU_ICON,
  "flex size-4 items-center justify-center text-[color:var(--rm-profile-custom-muted)]",
);

function ActionRow({
  icon,
  label,
  onClick,
  trailing,
  buttonRef,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  trailing?: ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick} className={ROW}>
      <span aria-hidden="true" className={ROW_ICON}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? (
        <span
          aria-hidden="true"
          className="shrink-0 text-[color:var(--rm-profile-custom-muted)]"
        >
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

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
  const profileDisplay = currentUser?.avatar_display ?? user.avatar_display;
  const [showStatusMenu, setShowStatusMenu] = useState(
    initialView === "status",
  );
  const [isEditingCustomStatus, setIsEditingCustomStatus] = useState(false);
  const [customStatusInput, setCustomStatusInput] = useState(
    user.custom_status || "",
  );
  const statusRowRef = useRef<HTMLButtonElement>(null);
  const statusBackRef = useRef<HTMLButtonElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const viewChangedRef = useRef(false);
  const statusLabelId = useId();

  const currentStatus = user.status ?? "online";
  const displayName = user.display_name?.trim() || user.username;
  const profileTheme = resolveProfileTheme(user);
  const currentStatusLabel =
    STATUS_OPTIONS.find((option) => option.value === currentStatus)?.label ??
    "Online";

  useEffect(() => {
    if (!isEditingCustomStatus) {
      const timeout = setTimeout(
        () => setCustomStatusInput(user.custom_status || ""),
        0,
      );
      return () => clearTimeout(timeout);
    }
  }, [user.custom_status, isEditingCustomStatus]);

  // Keyboard users land on the view they just switched to.
  useEffect(() => {
    if (!viewChangedRef.current) return;
    viewChangedRef.current = false;
    (showStatusMenu ? statusBackRef : statusRowRef).current?.focus();
  }, [showStatusMenu]);

  const switchView = (status: boolean) => {
    viewChangedRef.current = true;
    setShowStatusMenu(status);
  };

  const handleCustomStatusSave = () => {
    const value = customStatusInput.trim();

    if (value !== (user.custom_status || "")) {
      updateStatus(currentStatus, value || undefined);
    }

    setIsEditingCustomStatus(false);
  };

  return (
    <ResponsivePopover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="User Account Options"
      anchor={anchorEl}
      side="top"
      align="start"
      variant="rich"
      // Land on the first menu row, not the custom-status pill above it.
      initialFocus={showStatusMenu ? statusBackRef : firstRowRef}
      // The profile surface is the panel: it carries the radius, border and
      // shadow, and its frame art may overhang the edge.
      className="overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none dark:bg-transparent"
    >
      <ProfileSurfaceShell
        variant="popover"
        display={profileDisplay}
        className="w-full"
        surfaceClassName={cn(isMobile && "shadow-none")}
        style={profileTheme.variables}
      >
        <div className="max-h-[min(620px,var(--available-height,100dvh))] overflow-y-auto custom-scrollbar">
          <div
            className="relative h-28 overflow-hidden"
            style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
          >
            <ProfileAssetLayer
              url={user.banner_url}
              contentType={user.banner_content_type}
              alt="Profile banner"
              className="opacity-95"
            />
            <div
              className="absolute inset-0"
              style={{
                background: "var(--rm-profile-custom-banner-overlay)",
              }}
            />
          </div>

          <div className="relative z-20 px-4 pb-4">
            <div className="-mt-10 flex items-end gap-3">
              <div className="relative shrink-0">
                <div className="relative z-30 flex size-20 items-center justify-center overflow-visible rounded-full border-4 border-rm-bg-elevated bg-[var(--rm-profile-custom-button-bg)] text-ui-xl font-semibold text-[color:var(--rm-profile-custom-button-text)]">
                  {user.avatar_url ? (
                    <AvatarImage
                      src={getAuthAssetUrl(user.avatar_url)}
                      alt={displayName}
                      display={profileDisplay}
                    />
                  ) : (
                    displayName[0]?.toUpperCase()
                  )}
                </div>
                <div className="absolute right-0.5 bottom-0.5 z-30 flex size-5 items-center justify-center rounded-full border-4 border-rm-bg-elevated bg-rm-bg-elevated">
                  <UserStatusDot status={currentStatus} className="size-full" />
                </div>
              </div>

              <div className="mb-6 min-w-0 flex-1 pb-1">
                {isEditingCustomStatus ? (
                  <input
                    type="text"
                    className="h-9 w-full rounded-md border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 text-ui-sm text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                    aria-label="Custom status"
                    value={customStatusInput}
                    onChange={(event) =>
                      setCustomStatusInput(event.target.value)
                    }
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
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-1.5 text-left transition-colors pointer-fine:hover:bg-[var(--rm-profile-custom-card-bg)] outline-none"
                    aria-label="Edit custom status"
                    onClick={() => setIsEditingCustomStatus(true)}
                  >
                    <Icon
                      name="add"
                      size="sm"
                      className="shrink-0 text-[color:var(--rm-profile-custom-muted)]"
                    />
                    <span
                      className={cn(
                        "truncate text-ui-sm font-medium",
                        user.custom_status
                          ? "text-[color:var(--rm-profile-custom-text)]"
                          : "text-[color:var(--rm-profile-custom-muted)]",
                      )}
                    >
                      {user.custom_status || CUSTOM_STATUS_PLACEHOLDER}
                    </span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3">
              <ProfileDisplayName
                text={displayName}
                displayNameStyle={user.display_name_style}
                className="truncate text-ui-lg font-semibold text-[color:var(--rm-profile-custom-text)]"
                backgroundColor={profileTheme.backgroundColor}
                readableFallbackColor={profileTheme.textColor}
              />
              <p className="mt-1 text-ui-sm text-[color:var(--rm-profile-custom-muted)]">
                @{user.username}
              </p>
            </div>

            <div className="-mx-2 mt-4 flex flex-col">
              {showStatusMenu ? (
                <>
                  <div className="flex items-center gap-1 px-1 pb-1">
                    <IconButton
                      ref={statusBackRef}
                      icon="chevronLeft"
                      size="xs"
                      variant="muted"
                      aria-label="Back to account options"
                      onClick={() => switchView(false)}
                      className="text-[color:var(--rm-profile-custom-muted)] pointer-fine:hover:text-[color:var(--rm-profile-custom-text)]"
                    />
                    <span
                      id={statusLabelId}
                      className={cn(
                        MENU_LABEL,
                        "px-1 pt-0 pb-0 text-[color:var(--rm-profile-custom-muted)]",
                      )}
                    >
                      Status
                    </span>
                  </div>
                  <div
                    role="radiogroup"
                    aria-labelledby={statusLabelId}
                    className="flex flex-col"
                  >
                    {STATUS_OPTIONS.map((option) => {
                      const selected = currentStatus === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          // Selected (14.5): tint + weight, plus the check.
                          className={cn(
                            ROW,
                            selected &&
                              "bg-[var(--rm-profile-custom-card-bg-strong)] font-semibold",
                          )}
                          onClick={() => {
                            updateStatus(option.value, user.custom_status);
                            switchView(false);
                          }}
                        >
                          <span aria-hidden="true" className={ROW_ICON}>
                            <UserStatusDot
                              status={option.value}
                              className="size-3"
                            />
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
                </>
              ) : (
                <>
                  <ActionRow
                    buttonRef={firstRowRef}
                    icon={<Icon name="edit" size="sm" />}
                    label="Edit profile"
                    onClick={() => {
                      onClose();
                      onOpenProfileEditor(anchorEl);
                    }}
                  />
                  <ActionRow
                    buttonRef={statusRowRef}
                    icon={
                      <UserStatusDot
                        status={currentStatus}
                        className="size-3"
                      />
                    }
                    label={currentStatusLabel}
                    onClick={() => switchView(true)}
                    trailing={<Icon name="chevronRight" size="xs" />}
                  />
                  <div
                    role="separator"
                    className={cn(
                      MENU_SEPARATOR,
                      "mx-2 bg-[color:var(--rm-profile-custom-card-border)]",
                    )}
                  />
                  <ActionRow
                    icon={<Icon name="copy" size="sm" />}
                    label="Copy user ID"
                    onClick={() => {
                      void navigator.clipboard?.writeText(user.id);
                      onClose();
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </ProfileSurfaceShell>
    </ResponsivePopover>
  );
}
