"use client";

import { apiDelete, apiPost, apiPut } from "@/lib/api-client";
import { useChatActions, useChatState } from "@/lib/chat-context";
import { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import NextImage from "next/image";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Ban,
  Check,
  Copy,
  Loader2,
  MessageSquare,
  MoreVertical,
  UserMinus,
  UserPlus,
  X
} from "./Icons";

interface Props {
  user: User;
  onClose: () => void;
}

export default function UserProfileModal({ user, onClose }: Props) {
  const state = useChatState();
  const { openDm, loadRelationships, dispatch } = useChatActions();
  const [loading, setLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const relationship = state.relationships.find(r => r.user.id === user.id);
  const isMe = state.user?.id === user.id;

  // Handle outside click for options menu
  useEffect(() => {
    loadRelationships();
  }, [loadRelationships]);

  useEffect(() => {
    if (!showOptions) return;
    const handler = () => setShowOptions(false);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [showOptions]);

  const handleAction = useCallback(async (action: 'add' | 'remove' | 'accept' | 'block' | 'unblock') => {
    setLoading(true);
    try {
      if (action === 'add') {
        await apiPost("/api/friends", { username: user.username });
      } else if (action === 'accept' || action === 'block') {
        await apiPut("/api/friends", { target_user_id: user.id, action });
      } else if (action === 'remove' || action === 'unblock') {
        await apiDelete("/api/friends", { target_user_id: user.id });
      }
      await loadRelationships();
    } finally {
      setLoading(false);
      setShowOptions(false);
    }
  }, [user.id, user.username, loadRelationships]);

  const handleMessage = async () => {
    const channelId = await openDm(user.id);
    if (channelId) {
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      role="presentation"
    >
      <div
        className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary shadow-[0_32px_128px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-name"
      >
        {/* Banner area */}
        <div className="h-28 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-20 rounded-full bg-black/20 p-1.5 text-rm-text-muted/70 backdrop-blur-md transition-all hover:bg-black/40 hover:text-rm-text outline-none"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative px-6 pb-8">
          {/* Avatar */}
          <div className="absolute -top-12 left-6">
            <div className="relative">
              <div className="relative h-24 w-24 rounded-full border-[6px] border-rm-bg-primary bg-gradient-to-br from-indigo-500 to-purple-600 shadow-xl overflow-hidden">
                {user.avatar_url ? (
                  <NextImage src={user.avatar_url} alt={user.username} fill className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-rm-text shadow-inner">
                    {user.username[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className={cn(
                "absolute bottom-2 right-2 h-6 w-6 rounded-full border-4 border-rm-bg-primary shadow-md",
                user.status === 'online' ? "bg-emerald-500" :
                  user.status === 'idle' ? "bg-amber-500" :
                    user.status === 'dnd' ? "bg-rose-500" : "bg-rm-text-muted/40"
              )} />
            </div>
          </div>

          <div className="pt-16">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <h2 id="user-profile-name" className="truncate text-2xl font-bold text-rm-text tracking-tight">{user.username}</h2>
                <p className="mt-1 text-xs font-medium uppercase tracking-widest text-rm-text-muted">@{user.username.toLowerCase()}</p>
              </div>

              {!isMe && (
                <div className="ml-4 flex shrink-0 gap-2">
                  <button
                    onClick={handleMessage}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-rm-border bg-rm-bg-elevated text-rm-text-muted transition-all hover:bg-indigo-500 hover:text-white hover:border-indigo-400 outline-none"
                    title="Message"
                  >
                    <MessageSquare className="h-5 w-5" />
                  </button>
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowOptions(!showOptions);
                      }}
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-xl border border-rm-border bg-rm-bg-elevated text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text outline-none",
                        showOptions && "bg-rm-bg-active text-rm-text border-rm-bg-active"
                      )}
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>

                    {showOptions && (
                      <div
                        className="absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-elevated p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                        role="menu"
                      >
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(user.id);
                            setShowOptions(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-rm-text-secondary transition-all hover:bg-indigo-500 hover:text-rm-text outline-none"
                        >
                          <Copy className="h-4 w-4 opacity-60" />
                          Copy User ID
                        </button>
                        <div className="my-1 h-px bg-rm-border" />
                        <button
                          onClick={() => handleAction('block')}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-rose-400 transition-all hover:bg-rose-500 hover:text-rm-text outline-none"
                        >
                          <Ban className="h-4 w-4" />
                          Block User
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex flex-col gap-6">
              {/* Relationship actions */}
              {!isMe && (
                <div className="flex flex-col gap-2">
                  {relationship?.type === 0 ? (
                    <button
                      disabled={loading}
                      onClick={() => handleAction('remove')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 py-2.5 text-sm font-bold text-rose-400 transition-all hover:bg-rose-500 hover:text-white active:scale-95 disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                      Remove Friend
                    </button>
                  ) : relationship?.type === 2 ? (
                    <div className="flex gap-2">
                      <button
                        disabled={loading}
                        onClick={() => handleAction('accept')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-500 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-400 active:scale-95 disabled:opacity-50 shadow-[0_8px_16px_rgba(99,102,241,0.2)]"
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Accept
                      </button>
                      <button
                        disabled={loading}
                        onClick={() => handleAction('remove')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-rm-border bg-rm-bg-elevated py-2.5 text-sm font-bold text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text active:scale-95 disabled:opacity-50 outline-none"
                      >
                        Decline
                      </button>
                    </div>
                  ) : relationship?.type === 3 ? (
                    <button
                      disabled
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-rm-border bg-rm-bg-elevated/50 py-2.5 text-sm font-bold text-rm-text-muted opacity-50 outline-none"
                    >
                      Friend Request Sent
                    </button>
                  ) : relationship?.type === 1 ? (
                    <button
                      disabled={loading}
                      onClick={() => handleAction('unblock')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-rm-border bg-rm-bg-elevated py-2.5 text-sm font-bold text-rm-text-muted transition-all hover:bg-indigo-500 hover:text-white active:scale-95 outline-none"
                    >
                      Unblock User
                    </button>
                  ) : (
                    <button
                      disabled={loading}
                      onClick={() => handleAction('add')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-400 shadow-[0_8px_20px_rgba(99,102,241,0.3)] active:scale-95 disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      Add Friend
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-4">
                <div className="rounded-xl border border-rm-border bg-rm-bg-primary/30 p-4 transition-colors hover:bg-rm-bg-primary/50">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">About Me</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-rm-text-secondary">
                    This user hasn't added a bio yet. They are probably too busy chatting on Ralph Meet!
                  </p>
                </div>

                <div className="rounded-xl border border-rm-border bg-rm-bg-primary/30 p-4 transition-colors hover:bg-rm-bg-primary/50">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">Note</h3>
                  <textarea
                    placeholder="Click to add a note"
                    className="mt-2 w-full resize-none border-none bg-transparent p-0 text-[12px] text-rm-text-secondary outline-none placeholder:text-rm-text-muted/20"
                    rows={1}
                  />
                </div>

                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40">Member Since</span>
                  <span className="text-[11px] font-medium text-rm-text-muted">Jan 1, 2024</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
