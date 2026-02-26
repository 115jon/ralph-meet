"use client";

import { useChatState } from "@/lib/chat-context";
import { cn } from "@/lib/utils";
import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";

interface Props {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  anchorEl: HTMLElement;
  onClose: () => void;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
}

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

export default function UserProfilePopover({ userId, username, avatarUrl, anchorEl, onClose, side = "bottom", align = "start" }: Props) {
  const state = useChatState();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const width = 280;
    const height = 320; // Estimated max height

    let top = 0;
    let left = 0;

    if (side === "left") {
      left = rect.left - width - 8;
      top = rect.top + (rect.height / 2) - (150); // Center relative to anchor
    } else if (side === "right") {
      left = rect.right + 8;
      top = rect.top + (rect.height / 2) - 150;
    } else if (side === "top") {
      left = rect.left;
      top = rect.top - height - 8;
    } else {
      // Bottom (default)
      top = rect.bottom + 8;
      left = Math.min(rect.left, window.innerWidth - width - 8);
    }

    // Boundary checks
    const finalTop = Math.max(8, Math.min(top, window.innerHeight - 350));
    const finalLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8));

    setPosition({
      top: finalTop,
      left: finalLeft,
    });
  }, [anchorEl, side]);

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

  const member = state.members.find((m) => m.user.id === userId);
  const isOnline = state.onlineUsers.has(userId);
  const roleLabel = member?.role === 3 ? "Owner" : member?.role === 2 ? "Admin" : member?.role === 1 ? "Moderator" : "Member";

  return createPortal(
    <>
      {/* Overlay to block interaction and close on click-outside */}
      <div
        className="fixed inset-0 z-[999] cursor-default bg-transparent"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") onClose(); }}
        role="presentation"
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        className="fixed z-[1000] w-[280px] animate-in fade-in zoom-in-95 overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary shadow-[0_16px_48px_rgba(0,0,0,0.6)] duration-200 outline-none"
        style={{ top: position.top, left: position.left }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
        role="dialog"
        aria-modal="true"
        aria-label={`User profile for ${username}`}
        tabIndex={-1}
      >
        {/* Banner */}
        <div className="h-16 bg-gradient-to-r from-primary/40 to-primary/20" />

        {/* Avatar */}
        <div className="relative -mt-8 px-4">
          <div className="relative inline-block">
            <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-4 border-rm-bg-primary bg-primary text-lg font-bold text-primary-foreground border-rm-border transition-all">
              {avatarUrl ? (
                <NextImage src={avatarUrl} alt={username} fill className="object-cover" />
              ) : (
                username[0].toUpperCase()
              )}
            </div>
            <span
              className={cn(
                "absolute bottom-0 right-0 h-5 w-5 rounded-full border-[3px] border-rm-bg-primary",
                isOnline ? (statusColors[member?.user.status ?? "online"]) : statusColors["offline"]
              )}
            />
          </div>
        </div>

        {/* Info */}
        <div className="px-4 pb-3 pt-2">
          <h3 className="text-base font-bold text-rm-text">{username}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md bg-rm-bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-rm-text-muted border border-rm-border">
              {roleLabel}
            </span>
            <span className={cn(
              "text-xs font-medium",
              isOnline ? (member?.user.status === "online" ? "text-primary" : member?.user.status === "idle" ? "text-warning" : member?.user.status === "dnd" ? "text-destructive" : "text-primary") : "text-rm-text-muted"
            )}>
              {isOnline ? (member?.user.status === "online" ? "Online" : member?.user.status === "idle" ? "Away" : member?.user.status === "dnd" ? "Do Not Disturb" : "Online") : "Offline"}
            </span>
          </div>
        </div>

        <div className="h-px bg-rm-border" />

        {/* Details */}
        <div className="px-4 py-3">
          <div className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-rm-text-muted">Role</div>
          <div className="text-xs text-rm-text-secondary">{roleLabel}</div>
        </div>

        {userId !== state.user?.id && (
          <div className="border-t border-rm-border px-4 py-3">
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-rm-text-muted">Note</div>
            <input
              className="w-full bg-transparent text-xs text-rm-text-muted outline-none placeholder:text-rm-text-muted/30"
              placeholder="Click to add a note"
              readOnly
            />
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
