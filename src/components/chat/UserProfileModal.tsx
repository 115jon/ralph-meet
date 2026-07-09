import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import {
  PROFILE_SURFACE_ASPECT_RATIO,
  ProfilePreviewWidgetCard,
  ProfileSurfaceBackdrop,
} from "@/components/chat/ProfilePreviewPrimitives";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { BaseModal } from "@/components/ui/BaseModal";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import { resolveProfileTheme } from "@/lib/profile-customization";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { Ban, Check, Copy, Loader2, MessageSquare, UserMinus, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface Props {
  user: User;
  onClose: () => void;
  isClosing?: boolean;
}

type JoinedMemberRecord = {
  user: User;
  joined_at?: string | number | null;
};

type MutualFriendSummary = {
  count: number;
  items: Array<{
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_display?: User["avatar_display"];
  }>;
};

type MutualServerSummary = {
  count: number;
  items: Array<{
    id: string;
    name: string;
    icon_url?: string | null;
  }>;
};

type ProfileResponse = {
  user: User;
  mutualFriends: MutualFriendSummary;
  mutualServers: MutualServerSummary;
};

type RelationshipAction = "add" | "remove" | "accept" | "block" | "unblock";

const EMPTY_MUTUAL_FRIENDS: MutualFriendSummary = { count: 0, items: [] };
const EMPTY_MUTUAL_SERVERS: MutualServerSummary = { count: 0, items: [] };
const STATUS_CLASS_NAMES: Record<string, string> = {
  online: "bg-emerald-500",
  idle: "bg-amber-500",
  dnd: "bg-rose-500",
  offline: "bg-rm-text-muted/40",
};
const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

function StatRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[16px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--rm-profile-custom-muted)]">
        {label}
      </span>
      <span className="truncate text-right text-[13px] font-medium text-[color:var(--rm-profile-custom-text)]">
        {value}
      </span>
    </div>
  );
}

export default function UserProfileModal({ user, onClose, isClosing }: Props) {
  const relationships = useChatStore((state) => state.relationships);
  const currentUser = useChatStore((state) => state.user);
  const memberRecord = useChatStore((state) =>
    (state.members as JoinedMemberRecord[]).find((member) => member.user.id === user.id) ?? null,
  );
  const { openDm, loadRelationships, dispatch } = useChatActions();

  const [loading, setLoading] = useState(false);
  const [profileData, setProfileData] = useState<ProfileResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const relationship = relationships.find((entry) => entry.user.id === user.id);
  const seededUser = memberRecord?.user ?? (currentUser?.id === user.id ? currentUser : user);
  const resolvedUser = profileData?.user ?? seededUser;
  const isMe = currentUser?.id === resolvedUser.id;
  const displayName = getDisplayName(resolvedUser);
  const profileTheme = resolveProfileTheme(resolvedUser);
  const profileThemeStyle = profileTheme.variables;
  const profileReferenceDate = resolveProfileReferenceDate({
    joinedAt: memberRecord?.joined_at,
    createdAt: resolvedUser.created_at ?? null,
  });
  const mutualFriends = !isMe ? profileData?.mutualFriends ?? EMPTY_MUTUAL_FRIENDS : EMPTY_MUTUAL_FRIENDS;
  const mutualServers = !isMe ? profileData?.mutualServers ?? EMPTY_MUTUAL_SERVERS : EMPTY_MUTUAL_SERVERS;
  const customStatus = resolvedUser.custom_status?.trim() ?? "";
  const pronouns = resolvedUser.pronouns?.trim() ?? "";
  const bio = resolvedUser.bio?.trim() ?? "";
  const resolvedStatus = resolvedUser.status ?? "offline";
  const resolvedStatusLabel = STATUS_LABELS[resolvedStatus] ?? "Offline";

  useEffect(() => {
    void loadRelationships();
  }, [loadRelationships]);

  useEffect(() => {
    if (isMe) return undefined;

    let cancelled = false;
    setProfileError(null);

    void apiGet<ProfileResponse>(`/api/users/${user.id}/profile`)
      .then((data) => {
        if (cancelled) return;
        setProfileData(data);
      })
      .catch((error) => {
        if (cancelled) return;
        setProfileError(error instanceof Error ? error.message : "Unable to load the latest profile preview.");
      });

    return () => {
      cancelled = true;
    };
  }, [isMe, user.id]);

  const handleRelationshipAction = useCallback(async (action: RelationshipAction) => {
    setLoading(true);

    try {
      if (action === "add") {
        await apiPost("/api/friends", { username: resolvedUser.username });
      } else if (action === "accept" || action === "block") {
        await apiPut("/api/friends", { target_user_id: resolvedUser.id, action });
      } else if (action === "remove" || action === "unblock") {
        await apiDelete("/api/friends", { target_user_id: resolvedUser.id });
      }

      await loadRelationships();
    } finally {
      setLoading(false);
    }
  }, [loadRelationships, resolvedUser.id, resolvedUser.username]);

  const handleMessage = useCallback(async () => {
    if (isMe) return;

    const channelId = await openDm(resolvedUser.id);
    if (!channelId) return;

    dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
    onClose();
  }, [dispatch, isMe, onClose, openDm, resolvedUser.id]);

  const handleCopyUserId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resolvedUser.id);
    } catch {
      // Ignore clipboard failures and keep the preview usable.
    }
  }, [resolvedUser.id]);

  return (
    <BaseModal onClose={onClose}>
      <div
        className={cn(
          "fixed inset-0 z-[1100] flex items-center justify-center bg-black/62 p-4 backdrop-blur-sm animate-in fade-in duration-200",
          isClosing && "animate-out fade-out",
        )}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        role="presentation"
      >
        <dialog
          open
          className={cn(
            "relative m-0 w-full overflow-hidden rounded-[30px] border border-rm-border bg-[#09090d] shadow-[0_36px_110px_rgba(0,0,0,0.52)] outline-none animate-in zoom-in-95 duration-200",
            isClosing && "animate-out zoom-out-95",
          )}
          style={{
            width: "min(1240px, calc(100vw - 32px))",
            height: "min(860px, calc(100dvh - 32px))",
          }}
        >
          <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-rm-bg-primary">
            <div className="pointer-events-none absolute right-5 top-5 z-30">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="pointer-events-auto h-10 w-10 rounded-full border border-rm-border bg-rm-bg-floating/92 text-rm-text-muted shadow-[0_14px_34px_rgba(0,0,0,0.26)] backdrop-blur-md hover:bg-rm-bg-hover hover:text-rm-text"
                aria-label="Close profile preview"
              >
                <X size={18} />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-rm-bg-primary custom-scrollbar">
              <div className="h-full pb-24 md:pb-28 lg:pb-8">
                {profileError ? (
                  <div className="m-4 mb-0 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {profileError}
                  </div>
                ) : null}

                <div className="relative z-0 min-w-0 overflow-hidden bg-rm-bg-elevated md:grid md:grid-cols-[minmax(0,388px)_minmax(0,520px)] md:justify-center md:gap-6 md:px-5 md:py-5 lg:grid-cols-[minmax(0,400px)_minmax(0,540px)] lg:gap-8 lg:px-8 lg:py-8">
                  <div
                    className="pointer-events-none absolute inset-0 z-0"
                    style={{
                      ...profileThemeStyle,
                      backgroundImage: "var(--rm-profile-custom-surface)",
                    }}
                  />
                  <ProfileSurfaceBackdrop
                    bannerUrl={resolvedUser.banner_url}
                    bannerContentType={resolvedUser.banner_content_type}
                  />
                  <div className="pointer-events-none absolute inset-0 z-[2]" style={{ background: "var(--rm-profile-custom-surface-overlay-strong)" }} />

                  <section
                    className="relative z-10 mx-auto w-full max-w-[400px] self-start overflow-hidden rounded-[28px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] shadow-[0_26px_64px_rgba(0,0,0,0.26)] backdrop-blur-[18px]"
                    style={{
                      ...profileThemeStyle,
                      aspectRatio: PROFILE_SURFACE_ASPECT_RATIO,
                    }}
                  >
                    <div className="pointer-events-none absolute inset-0 z-[2]" style={{ background: "var(--rm-profile-custom-surface-overlay)" }} />
                    <div className="pointer-events-none absolute inset-0 z-30">
                      <ProfileCollectiblesLayer
                        display={resolvedUser.avatar_display}
                        effectOpacity={1}
                        fit="contain"
                        className="z-10 opacity-100"
                      />
                    </div>

                    <div
                      className="relative h-[18%] min-h-[128px] w-full overflow-hidden"
                      style={{ background: "var(--rm-profile-custom-banner-fallback)" }}
                    >
                      <ProfileAssetLayer
                        url={resolvedUser.banner_url}
                        contentType={resolvedUser.banner_content_type}
                        alt="Profile banner"
                        className="opacity-94"
                      />
                      <div className="absolute inset-0" style={{ background: "var(--rm-profile-custom-banner-overlay)" }} />
                    </div>

                    <div className="relative z-20 px-6 pb-7">
                      <div className="-mt-9">
                        <div className="flex items-start justify-between gap-4">
                          <div className="relative h-28 w-28 shrink-0 rounded-full border-[6px] border-rm-bg-elevated bg-[var(--rm-profile-custom-card-bg-strong)] shadow-[0_18px_46px_rgba(0,0,0,0.42)]">
                            {resolvedUser.avatar_url ? (
                              <AvatarImage
                                src={getAuthAssetUrl(resolvedUser.avatar_url)}
                                alt={displayName}
                                display={resolvedUser.avatar_display}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-full text-3xl font-bold text-[color:var(--rm-profile-custom-text)]">
                                {getDisplayInitial({ name: displayName })}
                              </div>
                            )}
                            <div className="absolute bottom-1 right-1 rounded-full border-4 border-rm-bg-elevated bg-[var(--rm-profile-custom-card-bg-strong)] p-1">
                              <span
                                className={cn(
                                  "block h-4 w-4 rounded-full",
                                  STATUS_CLASS_NAMES[resolvedStatus] ?? STATUS_CLASS_NAMES.offline,
                                )}
                              />
                            </div>
                          </div>

                          {customStatus ? (
                            <div className="relative ml-auto flex w-full min-w-0 max-w-[220px] justify-end pt-10">
                              <div className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-1.5 text-left shadow-[0_12px_28px_rgba(0,0,0,0.22)] backdrop-blur-md">
                                <span className="truncate text-[13px] italic font-medium text-[color:var(--rm-profile-custom-text)]">
                                  {customStatus}
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4">
                          <ProfileDisplayName
                            text={displayName}
                            displayNameStyle={resolvedUser.display_name_style}
                            className="truncate text-[20px] font-semibold tracking-[-0.03em] text-[color:var(--rm-profile-custom-text)]"
                            backgroundColor={profileTheme.backgroundColor}
                            readableFallbackColor={profileTheme.textColor}
                          />
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[color:var(--rm-profile-custom-muted)]">
                            <span>@{resolvedUser.username}</span>
                            {pronouns ? (
                              <>
                                <span aria-hidden="true" className="text-[color:var(--rm-profile-custom-muted)]/60">
                                  •
                                </span>
                                <span className="rounded-md border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] px-2 py-0.5 text-[13px] font-medium text-[color:var(--rm-profile-custom-text)]">
                                  {pronouns}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>

                        {!isMe ? (
                          <div className="mt-5 flex items-center gap-2">
                            <Button
                              type="button"
                              onClick={() => void handleMessage()}
                              className="h-10 rounded-xl bg-[var(--rm-profile-custom-button-bg)] px-4 text-[color:var(--rm-profile-custom-button-text)] shadow-[0_14px_28px_var(--rm-profile-custom-button-shadow)] hover:opacity-95"
                              style={profileThemeStyle}
                            >
                              <MessageSquare size={16} />
                              Message
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => void handleCopyUserId()}
                              className="h-10 rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 text-[color:var(--rm-profile-custom-text)] shadow-[0_12px_24px_rgba(0,0,0,0.22)] hover:bg-[var(--rm-profile-custom-card-bg)]"
                              style={profileThemeStyle}
                            >
                              <Copy size={15} />
                              Copy ID
                            </Button>
                          </div>
                        ) : null}

                        <div className="mt-5 space-y-5">
                          <div className="rounded-[18px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-4 py-3">
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--rm-profile-custom-muted)]">
                                Bio
                              </div>
                              <div className="rounded-[14px] border border-transparent px-0 py-0.5 text-[14px] leading-6 text-[color:var(--rm-profile-custom-text)]">
                                {bio || (
                                  <span className="text-[color:var(--rm-profile-custom-muted)]">
                                    This profile hasn&apos;t added a bio yet.
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--rm-profile-custom-muted)]">
                              {profileReferenceDate.label}
                            </div>
                            <div className="mt-2 text-[14px] text-[color:var(--rm-profile-custom-text)]">
                              {profileReferenceDate.value}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <aside className="relative z-10 mt-6 w-full max-w-[540px] self-start justify-self-center md:mt-0 md:flex md:h-full md:min-h-0 md:flex-col">
                    <div className="flex items-center gap-5 border-b border-[color:var(--rm-profile-custom-card-border)] pb-3" style={profileThemeStyle}>
                      {["Board", "Connections", "Activity"].map((tab, index) => (
                        <button
                          key={tab}
                          type="button"
                          className={cn(
                            "pb-2 text-[13px] font-semibold text-[color:var(--rm-profile-custom-muted)] transition",
                            index === 0 && "border-b-2 border-[color:var(--rm-profile-custom-text)] text-[color:var(--rm-profile-custom-text)]",
                          )}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-[13px] font-medium text-[color:var(--rm-profile-custom-muted)]" style={profileThemeStyle}>
                        {displayName}&apos;s widgets
                      </div>
                    </div>

                    <div className="mt-4 space-y-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1">
                      {!isMe ? (
                        <ProfilePreviewWidgetCard title="Relationship" subtitle="Quick actions">
                          <div className="space-y-3">
                            {relationship?.type === 0 ? (
                              <Button
                                type="button"
                                disabled={loading}
                                onClick={() => void handleRelationshipAction("remove")}
                                className="w-full rounded-xl border border-rose-500/25 bg-rose-500/12 text-rose-300 hover:bg-rose-500 hover:text-white"
                              >
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
                                Remove Friend
                              </Button>
                            ) : relationship?.type === 2 ? (
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => void handleRelationshipAction("accept")}
                                  className="rounded-xl bg-[var(--rm-profile-custom-button-bg)] text-[color:var(--rm-profile-custom-button-text)] shadow-[0_8px_20px_var(--rm-profile-custom-button-shadow)] hover:brightness-105"
                                  style={profileThemeStyle}
                                >
                                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                  Accept
                                </Button>
                                <Button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => void handleRelationshipAction("remove")}
                                  className="rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)] hover:bg-[var(--rm-profile-custom-card-bg)]"
                                  style={profileThemeStyle}
                                >
                                  Decline
                                </Button>
                              </div>
                            ) : relationship?.type === 3 ? (
                              <Button
                                type="button"
                                disabled
                                className="w-full rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)]/75 text-[color:var(--rm-profile-custom-muted)]"
                                style={profileThemeStyle}
                              >
                                Friend Request Sent
                              </Button>
                            ) : relationship?.type === 1 ? (
                              <Button
                                type="button"
                                disabled={loading}
                                onClick={() => void handleRelationshipAction("unblock")}
                                className="w-full rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)] hover:bg-[var(--rm-profile-custom-card-bg)]"
                                style={profileThemeStyle}
                              >
                                Unblock User
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                disabled={loading}
                                onClick={() => void handleRelationshipAction("add")}
                                className="w-full rounded-xl bg-[var(--rm-profile-custom-button-bg)] text-[color:var(--rm-profile-custom-button-text)] shadow-[0_8px_20px_var(--rm-profile-custom-button-shadow)] hover:brightness-105"
                                style={profileThemeStyle}
                              >
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                                Add Friend
                              </Button>
                            )}

                            <div className="grid gap-2 sm:grid-cols-2">
                              <Button
                                type="button"
                                onClick={() => void handleMessage()}
                                className="rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)] hover:bg-[var(--rm-profile-custom-card-bg)]"
                                style={profileThemeStyle}
                              >
                                <MessageSquare size={15} />
                                Message
                              </Button>
                              <Button
                                type="button"
                                onClick={() => void handleCopyUserId()}
                                className="rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)] hover:bg-[var(--rm-profile-custom-card-bg)]"
                                style={profileThemeStyle}
                              >
                                <Copy size={15} />
                                Copy ID
                              </Button>
                            </div>

                            {relationship?.type !== 1 ? (
                              <Button
                                type="button"
                                disabled={loading}
                                onClick={() => void handleRelationshipAction("block")}
                                className="w-full rounded-xl border border-rose-500/25 bg-rose-500/12 text-rose-300 hover:bg-rose-500 hover:text-white"
                              >
                                <Ban size={15} />
                                Block User
                              </Button>
                            ) : null}
                          </div>
                        </ProfilePreviewWidgetCard>
                      ) : null}

                      <ProfilePreviewWidgetCard title="Mutuals" subtitle="Shared circles">
                        <div className="space-y-4">
                          <div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[color:var(--rm-profile-custom-muted)]">
                                Friends
                              </span>
                              <span className="text-[13px] font-medium text-[color:var(--rm-profile-custom-text)]">
                                {mutualFriends.count}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {mutualFriends.items.length > 0 ? mutualFriends.items.map((friend) => (
                                <div
                                  key={friend.id}
                                  className="flex min-w-0 items-center gap-2 rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] py-1 pl-1 pr-3"
                                >
                                  <div className="relative h-7 w-7 overflow-hidden rounded-full bg-[var(--rm-profile-custom-card-bg)]">
                                    {friend.avatar_url ? (
                                      <AvatarImage
                                        src={getAuthAssetUrl(friend.avatar_url)}
                                        alt={getDisplayName(friend)}
                                        display={friend.avatar_display}
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-[color:var(--rm-profile-custom-text)]">
                                        {getDisplayInitial(friend)}
                                      </div>
                                    )}
                                  </div>
                                  <span className="max-w-[180px] truncate text-[13px] text-[color:var(--rm-profile-custom-text)]">
                                    {getDisplayName(friend)}
                                  </span>
                                </div>
                              )) : (
                                <div className="text-[13px] text-[color:var(--rm-profile-custom-muted)]">
                                  No shared friends yet.
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[color:var(--rm-profile-custom-muted)]">
                                Servers
                              </span>
                              <span className="text-[13px] font-medium text-[color:var(--rm-profile-custom-text)]">
                                {mutualServers.count}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {mutualServers.items.length > 0 ? mutualServers.items.map((server) => (
                                <div
                                  key={server.id}
                                  className="flex min-w-0 items-center gap-2 rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] py-1 pl-1 pr-3"
                                >
                                  <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[var(--rm-profile-custom-card-bg)] text-[10px] font-bold text-[color:var(--rm-profile-custom-text)]">
                                    {server.icon_url ? (
                                      <img
                                        src={getAuthAssetUrl(server.icon_url)}
                                        alt={server.name}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      server.name.charAt(0).toUpperCase()
                                    )}
                                  </div>
                                  <span className="max-w-[180px] truncate text-[13px] text-[color:var(--rm-profile-custom-text)]">
                                    {server.name}
                                  </span>
                                </div>
                              )) : (
                                <div className="text-[13px] text-[color:var(--rm-profile-custom-muted)]">
                                  No shared servers right now.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </ProfilePreviewWidgetCard>

                      <ProfilePreviewWidgetCard title="Details" subtitle="Profile snapshot">
                        <div className="space-y-3">
                          <StatRow label="Status" value={resolvedStatusLabel} />
                          <StatRow label={profileReferenceDate.label} value={profileReferenceDate.value} />
                          <StatRow label="Pronouns" value={pronouns || "Not set"} />
                        </div>
                      </ProfilePreviewWidgetCard>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </dialog>
      </div>
    </BaseModal>
  );
}
