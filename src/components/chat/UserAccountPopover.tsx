import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileTheme } from "@/lib/profile-customization";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import {
  UserStatusDot,
  type UserStatus,
} from "@/components/chat/UserStatusDot";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit2,
  Plus,
  User as UserIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  user: User;
  onClose: () => void;
  updateStatus: (status: UserStatus, custom_status?: string | null) => void;
  onOpenProfileEditor: (trigger?: HTMLElement) => void;
  anchorEl: HTMLElement;
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

const PROFILE_SURFACE_RATIO = 450 / 880;
const MOBILE_MAX_SURFACE_HEIGHT = 600;
const DESKTOP_MAX_SURFACE_HEIGHT = 620;
const ACTION_CARD_CLASS =
  "rounded-[18px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] p-2 shadow-[0_18px_38px_rgba(0,0,0,0.24)] backdrop-blur-md";
const ACTION_ROW_CLASS =
  "group/item flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-[color:var(--rm-profile-custom-text)] transition-colors hover:bg-[var(--rm-profile-custom-card-bg)] outline-none";

function ActionRow({
  icon,
  label,
  onClick,
  trailing,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        ACTION_ROW_CLASS,
        disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[color:var(--rm-profile-custom-muted)] group-hover/item:text-[color:var(--rm-profile-custom-text)]">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {trailing ? (
        <span className="ml-auto text-[color:var(--rm-profile-custom-muted)] group-hover/item:text-[color:var(--rm-profile-custom-text)]">
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
  isClosing,
}: Props & { isClosing?: boolean }) {
  const currentUser = useChatStore((state) =>
    state.user?.id === user.id ? state.user : null,
  );
  const profileDisplay = currentUser?.avatar_display ?? user.avatar_display;
  const popoverRef = useRef<HTMLDivElement>(null);
  const [dynamicStyle, setDynamicStyle] = useState<CSSProperties>({
    opacity: 0,
  });
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [isEditingCustomStatus, setIsEditingCustomStatus] = useState(false);
  const [customStatusInput, setCustomStatusInput] = useState(
    user.custom_status || "",
  );

  const currentStatus = user.status ?? "online";
  const displayName = user.display_name?.trim() || user.username;
  const profileTheme = resolveProfileTheme(user);
  const profileThemeStyle = profileTheme.variables;
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

  useEffect(() => {
    const updatePosition = () => {
      if (!popoverRef.current) return;

      const rect = anchorEl.getBoundingClientRect();
      const isMobile = window.innerWidth < 768;
      const viewportPadding = isMobile ? 8 : 10;
      const maxWidth = window.innerWidth - viewportPadding * 2;
      const maxHeight = Math.min(
        window.innerHeight - viewportPadding * 2,
        isMobile ? MOBILE_MAX_SURFACE_HEIGHT : DESKTOP_MAX_SURFACE_HEIGHT,
      );

      let width = Math.min(isMobile ? maxWidth : 332, maxWidth);
      let height = width / PROFILE_SURFACE_RATIO;

      if (height > maxHeight) {
        height = maxHeight;
        width = height * PROFILE_SURFACE_RATIO;
      }

      const style: CSSProperties = {
        opacity: 1,
        width,
        height,
      };

      if (isMobile) {
        style.left = Math.max(viewportPadding, (window.innerWidth - width) / 2);
        style.top = Math.max(
          viewportPadding,
          (window.innerHeight - height) / 2,
        );
        setDynamicStyle(style);
        return;
      }

      const left = rect.left - 12;
      let top = rect.top - height - 12;

      if (top < viewportPadding) {
        top = Math.min(
          window.innerHeight - height - viewportPadding,
          rect.bottom + 12,
        );
      }

      style.left = Math.max(
        viewportPadding,
        Math.min(left, window.innerWidth - width - viewportPadding),
      );
      style.top = Math.max(
        viewportPadding,
        Math.min(top, window.innerHeight - height - viewportPadding),
      );

      setDynamicStyle(style);
    };

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.cancelAnimationFrame(frameId);
    };
  }, [anchorEl]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        !anchorEl.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [anchorEl, onClose]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCustomStatusSave = () => {
    const value = customStatusInput.trim();

    if (value !== (user.custom_status || "")) {
      updateStatus(currentStatus, value || undefined);
    }

    setIsEditingCustomStatus(false);
  };

  return createPortal(
    <>
      <div
        className={cn(
          "fixed inset-0 z-[999] cursor-default bg-transparent",
          isClosing && "pointer-events-none",
        )}
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <ProfileSurfaceShell
        ref={popoverRef}
        variant="popover"
        display={profileDisplay}
        className={cn(
          "fixed z-[1000] animate-in fade-in zoom-in-95 duration-200 outline-none",
          isClosing && "animate-out fade-out zoom-out-95",
        )}
        style={{
          ...dynamicStyle,
          ...profileThemeStyle,
        }}
        aria-label="User Account Options"
        tabIndex={-1}
      >
        <div className="relative flex h-full flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div
              className="relative h-[18%] min-h-[118px] overflow-hidden"
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
                  <div className="relative z-30 flex h-[84px] w-[84px] items-center justify-center overflow-visible rounded-full border-[6px] border-rm-bg-elevated bg-[var(--rm-profile-custom-button-bg)] text-2xl font-bold text-[color:var(--rm-profile-custom-button-text)] shadow-[0_18px_46px_rgba(0,0,0,0.42)]">
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
                  <div className="absolute bottom-1 right-1 z-40 flex h-5 w-5 items-center justify-center rounded-full border-[3.5px] border-rm-bg-elevated bg-rm-bg-elevated">
                    <UserStatusDot
                      status={currentStatus}
                      className="h-full w-full"
                    />
                  </div>
                </div>

                <div className="relative mb-6 min-w-0 flex-1 pb-1">
                  <button
                    type="button"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-1.5 text-left shadow-[0_12px_28px_rgba(0,0,0,0.22)] backdrop-blur-md transition-colors hover:bg-[var(--rm-profile-custom-card-bg)] outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                    aria-label="Edit custom status"
                    onClick={() => setIsEditingCustomStatus(true)}
                  >
                    <Plus
                      size={14}
                      className="shrink-0 text-[color:var(--rm-profile-custom-muted)]"
                    />
                    <span className="truncate text-[13px] italic font-medium text-[color:var(--rm-profile-custom-text)]">
                      {user.custom_status || "Today I learned..."}
                    </span>
                  </button>

                  {isEditingCustomStatus ? (
                    <div className="absolute -inset-x-2 -bottom-2 -top-2 z-50 flex items-center rounded-2xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] p-1 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl animate-in fade-in zoom-in-95">
                      <input
                        type="text"
                        className="flex-1 rounded-xl bg-white/10 px-3 py-2 text-[13px] text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                        aria-label="Custom status"
                        value={customStatusInput}
                        onChange={(event) =>
                          setCustomStatusInput(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleCustomStatusSave();
                          if (event.key === "Escape") {
                            setCustomStatusInput(user.custom_status || "");
                            setIsEditingCustomStatus(false);
                          }
                        }}
                        onBlur={handleCustomStatusSave}
                        placeholder="Support custom status!"
                        maxLength={128}
                        autoFocus
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3">
                <ProfileDisplayName
                  text={displayName}
                  displayNameStyle={user.display_name_style}
                  className="truncate text-[20px] font-semibold tracking-[-0.03em] text-[color:var(--rm-profile-custom-text)]"
                  backgroundColor={profileTheme.backgroundColor}
                  readableFallbackColor={profileTheme.textColor}
                />
                <p className="mt-1 text-[13px] text-[color:var(--rm-profile-custom-muted)]">
                  @{user.username}
                </p>
              </div>

              <div className="mt-5 space-y-3">
                {showStatusMenu ? (
                  <div className={ACTION_CARD_CLASS}>
                    <div className="flex items-center px-2 py-1">
                      <button
                        type="button"
                        aria-label="Back to account options"
                        onClick={() => setShowStatusMenu(false)}
                        className="mr-2 flex items-center justify-center rounded-lg p-1 text-[color:var(--rm-profile-custom-muted)] transition-colors hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)]"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--rm-profile-custom-muted)]">
                        Status
                      </span>
                    </div>
                    <div className="mx-2 my-1 h-px bg-[color:var(--rm-profile-custom-card-border)]" />
                    {STATUS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={cn(ACTION_ROW_CLASS, "px-3")}
                        onClick={() => {
                          updateStatus(option.value, user.custom_status);
                          setShowStatusMenu(false);
                        }}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          <UserStatusDot
                            status={option.value}
                            className="h-3 w-3"
                          />
                        </span>
                        <span className="truncate">{option.label}</span>
                        {currentStatus === option.value ? (
                          <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--rm-profile-custom-text)]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--rm-profile-custom-card-bg-strong)]" />
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className={ACTION_CARD_CLASS}>
                      <ActionRow
                        icon={<Edit2 className="h-4 w-4" />}
                        label="Edit Profile"
                        onClick={() => {
                          onClose();
                          onOpenProfileEditor(anchorEl);
                        }}
                      />
                      <ActionRow
                        icon={
                          <UserStatusDot
                            status={currentStatus}
                            className="h-3 w-3"
                          />
                        }
                        label={currentStatusLabel}
                        onClick={() => setShowStatusMenu(true)}
                        trailing={<ChevronRight size={16} />}
                      />
                    </div>

                    <div className={ACTION_CARD_CLASS}>
                      <ActionRow
                        icon={<UserIcon className="h-4 w-4" />}
                        label="Switch Accounts"
                        disabled
                        trailing={<ChevronRight size={16} />}
                      />
                      <ActionRow
                        icon={<Copy className="h-4 w-4" />}
                        label="Copy User ID"
                        onClick={() => {
                          navigator.clipboard.writeText(user.id);
                          onClose();
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </ProfileSurfaceShell>
    </>,
    document.body,
  );
}
