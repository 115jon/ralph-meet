
import { getAuthAssetUrl } from "@/lib/platform";
import { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Copy, Edit2, User as UserIcon } from "lucide-react";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  user: User;
  onClose: () => void;
  updateStatus: (status: "online" | "idle" | "dnd" | "offline", custom_status?: string) => void;
  onOpenSettings: () => void;
  anchorEl: HTMLElement;
}

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

const STATUS_OPTIONS = [
  { value: "online" as const, label: "Online", color: "bg-primary" },
  { value: "idle" as const, label: "Idle", color: "bg-warning" },
  { value: "dnd" as const, label: "Do Not Disturb", color: "bg-destructive" },
  { value: "offline" as const, label: "Invisible", color: "bg-rm-text-muted/40" },
];

export default function UserAccountPopover({ user, onClose, updateStatus, onOpenSettings, anchorEl }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // Custom status input state
  const [isEditingCustomStatus, setIsEditingCustomStatus] = useState(false);
  const [customStatusInput, setCustomStatusInput] = useState(user.custom_status || "");

  const currentStatus = user.status ?? "online";
  const displayName = user.display_name?.trim() || user.username;

  // Keep custom status input in sync when user data loads/changes
  useEffect(() => {
    if (!isEditingCustomStatus) {
      const t = setTimeout(() => setCustomStatusInput(user.custom_status || ""), 0);
      return () => clearTimeout(t);
    }
  }, [user.custom_status, isEditingCustomStatus]);

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const width = 340;

    // Position above the user panel, slightly to the left
    const top = rect.top - 20;
    const left = rect.left - 10;

    // We adjust top after render to account for actual height, but for now we just position it to grow upwards
    const t = setTimeout(() => setPosition({ top, left }), 0);
    return () => clearTimeout(t);
  }, [anchorEl]);

  // Handle clicking outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
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
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCustomStatusSave = () => {
    const val = customStatusInput.trim();
    if (val !== (user.custom_status || "")) {
      updateStatus(currentStatus, val || undefined);
    }
    setIsEditingCustomStatus(false);
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[999] cursor-default bg-transparent"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        // Use a dynamic transform to make it pop up from the bottom-left anchor correctly
        className="fixed z-[1000] w-[340px] animate-in fade-in zoom-in-95 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated shadow-[0_8px_32px_rgba(0,0,0,0.6)] duration-200 outline-none -translate-y-full"
        style={{ top: position.top, left: position.left }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
        role="dialog"
        aria-modal="true"
        aria-label="User Account Options"
        tabIndex={-1}
      >
        {/* Banner */}
        <div className="h-[105px] bg-[#A69E8F]" />

        {/* Avatar & Custom Status section */}
        <div className="relative -mt-10 px-4 flex items-end">
          <div className="relative inline-block z-10 shrink-0">
            <div className="relative flex h-[82px] w-[82px] items-center justify-center overflow-hidden rounded-full border-[6px] border-rm-bg-elevated bg-primary text-xl font-bold text-primary-foreground transition-all">
              {user.avatar_url ? (
                <img src={getAuthAssetUrl(user.avatar_url)} alt={displayName} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
              ) : (
                displayName[0].toUpperCase()
              )}
            </div>
            <div className="absolute bottom-1 right-1 h-5 w-5 rounded-full border-[3.5px] border-rm-bg-elevated bg-rm-bg-elevated flex items-center justify-center">
              <span className={cn("relative h-full w-full rounded-full", statusColors[currentStatus])}>
                {currentStatus === "offline" && <span className="absolute inset-[3px] rounded-full bg-rm-bg-elevated" />}
                {currentStatus === "dnd" && <span className="absolute inset-x-[2px] top-[40%] h-[20%] rounded-sm bg-rm-bg-elevated" />}
              </span>
            </div>
          </div>

          {/* Custom Status Bubble floating next to avatar */}
          <div className="relative mb-6 ml-2 flex-1 pb-1">
            <div
              role="button"
              tabIndex={0}
              className="inline-flex max-w-[190px] cursor-pointer items-center gap-1.5 rounded-full bg-rm-bg-primary/80 border border-white/5 backdrop-blur-md px-3 py-1.5 shadow-sm transition-colors hover:bg-rm-bg-hover outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              onClick={() => setIsEditingCustomStatus(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIsEditingCustomStatus(true);
                }
              }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-rm-text-muted">
                +
              </span>
              <span className="truncate text-[13px] italic font-medium text-rm-text-primary">
                {user.custom_status || "Today I learned..."}
              </span>
            </div>

            {/* Edit input overlay */}
            {isEditingCustomStatus && (
              <div className="absolute -inset-x-2 -bottom-2 -top-2 z-20 flex items-center rounded-lg bg-rm-bg-elevated p-1 shadow-lg border border-rm-border animate-in fade-in zoom-in-95">
                <input
                  type="text"
                  className="flex-1 bg-rm-bg-primary rounded px-2 py-1.5 text-[13px] text-rm-text outline-none"
                  value={customStatusInput}
                  onChange={(e) => setCustomStatusInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCustomStatusSave();
                    if (e.key === "Escape") {
                      setCustomStatusInput(user.custom_status || "");
                      setIsEditingCustomStatus(false);
                    }
                  }}
                  onBlur={handleCustomStatusSave}
                  placeholder="Support custom status!"
                  maxLength={128}
                />
              </div>
            )}
          </div>
        </div>

        {/* User Info */}
        <div className="mt-2 px-4 pb-4">
          <h2 className="text-xl font-extrabold text-rm-text">{displayName}</h2>
          <p className="text-[13px] text-rm-text-primary">@{user.username}</p>
        </div>

        {/* Menu Items */}
        <div className="px-2 pb-2">
          {showStatusMenu ? (
            // Status Submenu
            <div className="rounded-lg bg-rm-bg-primary p-1 animate-in fade-in slide-in-from-right-4">
              <div className="flex items-center px-2 py-1 mb-1">
                <button
                  onClick={() => setShowStatusMenu(false)}
                  className="mr-2 text-rm-text-muted hover:text-rm-text flex items-center justify-center rounded p-1"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                </button>
                <span className="text-xs font-bold uppercase text-rm-text-muted">Status</span>
              </div>
              <div className="h-px bg-white/5 mx-2 mb-1" />
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className="flex w-full items-center gap-3 rounded-[4px] px-2 py-1.5 transition-colors hover:bg-rm-ui-active group/item outline-none"
                  onClick={() => {
                    updateStatus(opt.value, user.custom_status);
                    setShowStatusMenu(false);
                    onClose();
                  }}
                >
                  <div className="relative flex h-4 w-4 items-center justify-center">
                    <span className={cn("relative h-3 w-3 rounded-full", opt.color)}>
                      {opt.value === "offline" && <span className="absolute inset-[3.5px] rounded-full bg-rm-bg-primary group-hover/item:bg-rm-ui-active transition-colors" />}
                      {opt.value === "dnd" && <span className="absolute inset-x-[3.5px] top-[42%] h-[16%] rounded-sm bg-rm-bg-primary group-hover/item:bg-rm-ui-active transition-colors" />}
                    </span>
                  </div>
                  <span className="text-[14px] font-medium text-rm-text-secondary group-hover/item:text-rm-text">
                    {opt.label}
                  </span>
                  {currentStatus === opt.value && (
                    <div className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-rm-text">
                      <div className="h-1.5 w-1.5 rounded-full bg-rm-bg-primary" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : (
            // Main Menu
            <div className="rounded-lg bg-rm-bg-primary p-1">
              {/* Group 1 */}
              <button
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-3 rounded-[4px] px-2 py-1.5 text-[14px] font-medium text-rm-text transition-colors hover:bg-rm-ui-active outline-none group"
              >
                <Edit2 className="h-4 w-4 shrink-0 text-rm-text-muted group-hover:text-rm-text" />
                <span>Edit Profile</span>
              </button>

              <button
                onClick={() => setShowStatusMenu(true)}
                className="flex w-full items-center gap-3 rounded-[4px] px-2 py-1.5 text-[14px] font-medium text-rm-text transition-colors hover:bg-rm-ui-active outline-none group"
              >
                <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <span className={cn("relative h-3 w-3 rounded-full", statusColors[currentStatus])}>
                    {currentStatus === "offline" && <span className="absolute inset-[3.5px] rounded-full bg-rm-bg-primary group-hover:bg-rm-ui-active transition-colors" />}
                    {currentStatus === "dnd" && <span className="absolute inset-x-[3.5px] top-[42%] h-[16%] rounded-sm bg-rm-bg-primary group-hover:bg-rm-ui-active transition-colors" />}
                  </span>
                </div>
                <span>
                  {currentStatus === "online" ? "Online" : currentStatus === "idle" ? "Idle" : currentStatus === "dnd" ? "Do Not Disturb" : "Invisible"}
                </span>
                <div className="ml-auto text-rm-text-muted group-hover:text-rm-text">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </div>
              </button>

              <div className="my-1 h-px bg-white/5 mx-2" />

              {/* Group 2 */}
              <button className="flex w-full items-center gap-3 rounded-[4px] px-2 py-1.5 text-[14px] font-medium text-rm-text transition-colors hover:bg-rm-ui-active outline-none group opacity-50 cursor-not-allowed">
                <UserIcon className="h-4 w-4 shrink-0 text-rm-text-muted group-hover:text-rm-text" />
                <span>Switch Accounts</span>
                <div className="ml-auto text-rm-text-muted group-hover:text-rm-text">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </div>
              </button>

              <button
                className="flex w-full items-center gap-3 rounded-[4px] px-2 py-1.5 text-[14px] font-medium text-rm-text transition-colors hover:bg-rm-ui-active outline-none group"
                onClick={() => {
                  navigator.clipboard.writeText(user.id);
                  onClose();
                }}
              >
                <Copy className="h-4 w-4 shrink-0 text-rm-text-muted group-hover:text-rm-text" />
                <span>Copy User ID</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
