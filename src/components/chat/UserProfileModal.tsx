
import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { BaseModal } from "@/components/ui/BaseModal";
import { ButtonBase } from "@/components/ui/button-base";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import { resolveProfileTheme } from "@/lib/profile-customization";
import { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";

import { useCallback, useEffect, useState } from "react";
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
  isClosing?: boolean;
}

type JoinedMemberRecord = {
  user: User;
  joined_at?: string | number | null;
};

export default function UserProfileModal({ user, onClose, isClosing }: Props) {
  const relationships = useChatStore(s => s.relationships);
  const currentUser = useChatStore(s => s.user);
  const memberRecord = useChatStore((state) =>
    (state.members as JoinedMemberRecord[]).find((member) => member.user.id === user.id) ?? null,
  );
  const { openDm, loadRelationships, dispatch } = useChatActions();
  const [loading, setLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);

  const relationship = relationships.find((r: any) => r.user.id === user.id);
  const memberUser = memberRecord?.user ?? null;
  const seedUser = memberUser ?? (currentUser?.id === user.id ? currentUser : user);
  const liveProfileUser = profileUser?.id === user.id ? profileUser : null;
  const resolvedUser = liveProfileUser ?? seedUser;
  const isMe = currentUser?.id === resolvedUser.id;
  const displayName = resolvedUser.display_name?.trim() || resolvedUser.username;
  const profileTheme = resolveProfileTheme(resolvedUser);
  const profileThemeStyle = profileTheme.variables;
  const profileReferenceDate = resolveProfileReferenceDate({
    joinedAt: memberRecord?.joined_at,
    createdAt: resolvedUser.created_at ?? null,
  });

  // Handle outside click for options menu
  useEffect(() => {
    loadRelationships();
  }, [loadRelationships]);

  useEffect(() => {
    let cancelled = false;

    apiGet<{ user: User }>(`/api/users/${user.id}/profile`)
      .then((data) => {
        if (!cancelled) setProfileUser(data.user ?? null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user.id]);

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
        await apiPost("/api/friends", { username: resolvedUser.username });
      } else if (action === 'accept' || action === 'block') {
        await apiPut("/api/friends", { target_user_id: resolvedUser.id, action });
      } else if (action === 'remove' || action === 'unblock') {
        await apiDelete("/api/friends", { target_user_id: resolvedUser.id });
      }
      await loadRelationships();
    } finally {
      setLoading(false);
      setShowOptions(false);
    }
  }, [resolvedUser.id, resolvedUser.username, loadRelationships]);

  const handleMessage = async () => {
    const channelId = await openDm(resolvedUser.id);
    if (channelId) {
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
      onClose();
    }
  };

  return (
    <BaseModal onClose={onClose}>
      <div
        className={cn(
          "fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200",
          isClosing && "animate-out fade-out"
        )}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        role="presentation"
      >
          <dialog
            open
            className={cn(
              "relative m-0 w-full max-w-[420px] overflow-hidden rounded-2xl border border-[color:var(--rm-profile-custom-card-border)] bg-rm-bg-primary p-0 shadow-[0_32px_128px_rgba(0,0,0,0.8)] outline-none animate-in zoom-in-95 duration-200",
              isClosing && "animate-out zoom-out-95"
            )}
            style={{
              ...profileThemeStyle,
              backgroundImage: "var(--rm-profile-custom-surface)",
            }}
            aria-labelledby="user-profile-name"
          >
          {/* Banner area */}
          <div className="relative h-28 overflow-hidden" style={{ background: "var(--rm-profile-custom-banner-fallback)" }}>
            <ProfileAssetLayer
              url={resolvedUser.banner_url}
              contentType={resolvedUser.banner_content_type}
              alt="Profile banner"
              className="opacity-95"
            />
            <div className="absolute inset-0" style={{ background: "var(--rm-profile-custom-banner-overlay)" }} />
          </div>

          {/* Close Button */}
          <ButtonBase
            onClick={onClose}
            className="absolute right-4 top-4 z-20 rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] p-1.5 text-[color:var(--rm-profile-custom-muted)] backdrop-blur-md transition-all hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)] outline-none"
          >
            <X className="h-5 w-5" />
          </ButtonBase>

          <div className="relative px-6 pb-8">
            {/* Avatar */}
            <div className="absolute -top-12 left-6">
              <div className="relative">
                <div className="relative h-24 w-24 overflow-hidden rounded-full border-[6px] border-[var(--rm-profile-custom-card-bg-strong)] bg-[var(--rm-profile-custom-button-bg)] shadow-xl">
                  {resolvedUser.avatar_url ? (
                    <AvatarImage src={getAuthAssetUrl(resolvedUser.avatar_url)} alt={displayName} display={resolvedUser.avatar_display} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-[color:var(--rm-profile-custom-button-text)] shadow-inner">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className={cn(
                  "absolute bottom-2 right-2 h-6 w-6 rounded-full border-4 border-[var(--rm-profile-custom-card-bg-strong)] shadow-md",
                  resolvedUser.status === 'online' ? "bg-emerald-500" :
                    resolvedUser.status === 'idle' ? "bg-amber-500" :
                      resolvedUser.status === 'dnd' ? "bg-rose-500" : "bg-rm-text-muted/40"
                )} />
              </div>
            </div>

            <div className="pt-16">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h2 id="user-profile-name" className="truncate text-2xl font-bold tracking-tight">
                    <ProfileDisplayName
                      text={displayName}
                      displayNameStyle={resolvedUser.display_name_style}
                      className="truncate text-[color:var(--rm-profile-custom-text)]"
                      backgroundColor={profileTheme.backgroundColor}
                      readableFallbackColor={profileTheme.textColor}
                    />
                  </h2>
                  <p className="mt-1 text-xs font-medium uppercase tracking-widest text-[color:var(--rm-profile-custom-muted)]">@{resolvedUser.username.toLowerCase()}</p>
                </div>

                {!isMe && (
                  <div className="ml-4 flex shrink-0 gap-2">
                    <ButtonBase
                      onClick={handleMessage}
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-muted)] transition-all hover:bg-[var(--rm-profile-custom-button-bg)] hover:text-[color:var(--rm-profile-custom-button-text)] outline-none"
                      title="Message"
                    >
                      <MessageSquare className="h-5 w-5" />
                    </ButtonBase>
                    <div className="relative">
                      <ButtonBase
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowOptions(!showOptions);
                        }}
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-muted)] transition-all hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)] outline-none",
                          showOptions && "bg-[var(--rm-profile-custom-card-bg)] text-[color:var(--rm-profile-custom-text)]"
                        )}
                      >
                        <MoreVertical className="h-5 w-5" />
                      </ButtonBase>

                      {showOptions && (
                        <div
                          className="absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] p-1.5 text-[color:var(--rm-profile-custom-text)] shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => e.stopPropagation()}
                          role="menu"
                          tabIndex={-1}
                        >
                          <ButtonBase
                            onClick={() => {
                              navigator.clipboard.writeText(resolvedUser.id);
                              setShowOptions(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-[color:var(--rm-profile-custom-muted)] transition-all hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)] outline-none"
                          >
                            <Copy className="h-4 w-4 opacity-60" />
                            Copy User ID
                          </ButtonBase>
                          <div className="my-1 h-px bg-[color:var(--rm-profile-custom-card-border)]" />
                          <ButtonBase
                            onClick={() => handleAction('block')}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-rose-400 transition-all hover:bg-rose-500 hover:text-rm-text outline-none"
                          >
                            <Ban className="h-4 w-4" />
                            Block User
                          </ButtonBase>
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
                      <ButtonBase
                        disabled={loading}
                        onClick={() => handleAction('remove')}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/12 py-2.5 text-sm font-bold text-rose-300 transition-all hover:bg-rose-500 hover:text-white active:scale-95 disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                        Remove Friend
                      </ButtonBase>
                    ) : relationship?.type === 2 ? (
                      <div className="flex gap-2">
                        <ButtonBase
                        disabled={loading}
                        onClick={() => handleAction('accept')}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--rm-profile-custom-button-bg)] py-2.5 text-sm font-bold text-[color:var(--rm-profile-custom-button-text)] transition-all active:scale-95 disabled:opacity-50 shadow-[0_8px_16px_var(--rm-profile-custom-button-shadow)] hover:brightness-105"
                        >
                          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          Accept
                        </ButtonBase>
                        <ButtonBase
                        disabled={loading}
                        onClick={() => handleAction('remove')}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] py-2.5 text-sm font-bold text-[color:var(--rm-profile-custom-muted)] transition-all hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)] active:scale-95 disabled:opacity-50 outline-none"
                        >
                          Decline
                        </ButtonBase>
                      </div>
                    ) : relationship?.type === 3 ? (
                      <ButtonBase
                        disabled
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]/70 py-2.5 text-sm font-bold text-[color:var(--rm-profile-custom-muted)] opacity-50 outline-none"
                      >
                        Friend Request Sent
                      </ButtonBase>
                    ) : relationship?.type === 1 ? (
                      <ButtonBase
                        disabled={loading}
                        onClick={() => handleAction('unblock')}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] py-2.5 text-sm font-bold text-[color:var(--rm-profile-custom-muted)] transition-all hover:bg-[var(--rm-profile-custom-button-bg)] hover:text-[color:var(--rm-profile-custom-button-text)] active:scale-95 outline-none"
                      >
                        Unblock User
                      </ButtonBase>
                    ) : (
                      <ButtonBase
                        disabled={loading}
                        onClick={() => handleAction('add')}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--rm-profile-custom-button-bg)] py-2.5 text-sm font-bold text-[color:var(--rm-profile-custom-button-text)] transition-all shadow-[0_8px_20px_var(--rm-profile-custom-button-shadow)] hover:brightness-105 active:scale-95 disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                        Add Friend
                      </ButtonBase>
                    )}
                  </div>
                )}

                <div className="space-y-4">
                  <div className="rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]/92 p-4 transition-colors hover:bg-[var(--rm-profile-custom-card-bg)]">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-[color:var(--rm-profile-custom-muted)]">About Me</h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--rm-profile-custom-text)]">
                      This user hasn't added a bio yet. They are probably too busy chatting on Ralph Meet!
                    </p>
                  </div>

                  <div className="rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]/92 p-4 transition-colors hover:bg-[var(--rm-profile-custom-card-bg)]">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-[color:var(--rm-profile-custom-muted)]">Note</h3>
                    <textarea
                      aria-label="Note about this user"
                      placeholder="Click to add a note"
                      className="mt-2 w-full resize-none border-none bg-transparent p-0 text-[12px] text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]/45"
                      rows={1}
                    />
                  </div>

                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[color:var(--rm-profile-custom-muted)]/60">{profileReferenceDate.label}</span>
                    <span className="text-[11px] font-medium text-[color:var(--rm-profile-custom-muted)]">{profileReferenceDate.value}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </dialog>
      </div>
    </BaseModal>
  );
}
