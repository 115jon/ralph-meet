import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { useContextMenu } from "@/hooks/useContextMenu";
import { getAuthAssetUrl } from "@/lib/platform";
import type { VoiceChannelMember } from "@/lib/chat-reducer";
import type { Channel, Server } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ContextMenu from "./ContextMenu";
import CreateServerModal from "./CreateServerModal";
import { HomeIcon } from "./HomeIcon";
import { Check, Copy, Plus, Trash2 } from "./Icons";

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_CHANNELS_BY_SERVER: Record<string, Channel[]> = {};
const EMPTY_VOICE_STATES: Record<string, VoiceChannelMember[]> = {};
const EMPTY_OBJECT = {};
const EMPTY_MENTION_COUNTS: Record<string, number> = {};
const EMPTY_UNREAD_DMS: UnreadDm[] = [];
const MAX_VISIBLE_DMS = 3;
const MAX_VISIBLE_VOICE_CHANNELS = 3;
const MAX_VISIBLE_VOICE_AVATARS = 5;

interface UnreadDm {
  channelId: string;
  recipient: { id: string; username: string; display_name?: string | null; avatar_url?: string | null };
  unreadCount?: number;
}

interface ServerVoiceChannelSummary {
  channelId: string;
  channelName: string;
  members: VoiceChannelMember[];
}

interface ServerVoiceSummary {
  activeChannels: ServerVoiceChannelSummary[];
  totalMembers: number;
}

interface Props {
  servers: Server[];
  activeServerId: string | null;
  activeChannelId?: string | null;
  onSelect: (serverId: string) => void;
  channels?: Channel[];
  channelsByServerId?: Record<string, Channel[]>;
  voiceChannelStates?: Record<string, VoiceChannelMember[]>;
  localVoiceServerId?: string | null;
  readStates?: Record<string, string>;
  lastMessageAt?: Record<string, string>;
  serverMentionCounts?: Record<string, number>;
  homeBadgeCount?: number;
  unreadDms?: UnreadDm[];
  onSelectDm?: (channelId: string) => void;
  onMarkServerRead?: (serverId: string) => void;
  onMarkAllRead?: () => void;
}

function serverHasUnread(
  serverId: string,
  channels: Channel[],
  readStates: Record<string, string>,
  lastMessageAt: Record<string, string>,
): boolean {
  const serverChannels = channels.filter((channel) => channel.server_id === serverId);
  return serverChannels.some((channel) => {
    const lastMessage = lastMessageAt[channel.id];
    if (!lastMessage) return false;
    const lastRead = readStates[channel.id];
    if (!lastRead) return true;
    return lastMessage > lastRead;
  });
}

function formatVoiceSummary(totalMembers: number, activeChannelCount: number): string {
  const peopleLabel = totalMembers === 1 ? "1 person" : `${totalMembers} people`;
  const channelLabel = activeChannelCount === 1 ? "1 channel" : `${activeChannelCount} channels`;
  return `${peopleLabel} across ${channelLabel}`;
}

function formatMoreChannels(count: number): string {
  return count === 1 ? "+1 more active voice channel" : `+${count} more active voice channels`;
}

export default function ServerList({
  servers,
  activeServerId,
  activeChannelId,
  onSelect,
  channels = EMPTY_CHANNELS,
  channelsByServerId = EMPTY_CHANNELS_BY_SERVER,
  voiceChannelStates = EMPTY_VOICE_STATES,
  localVoiceServerId = null,
  readStates = EMPTY_OBJECT,
  lastMessageAt = EMPTY_OBJECT,
  serverMentionCounts = EMPTY_MENTION_COUNTS,
  homeBadgeCount = 0,
  unreadDms = EMPTY_UNREAD_DMS,
  onSelectDm,
  onMarkServerRead,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [dmExpanded, setDmExpanded] = useState(false);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const handleServerContextMenu = (event: React.MouseEvent, server: Server) => {
    const hasUnread = serverHasUnread(server.id, channels, readStates, lastMessageAt);
    openMenu(event, [
      {
        label: "Mark as Read",
        icon: <Check className="h-4 w-4" />,
        onClick: () => onMarkServerRead?.(server.id),
        disabled: !hasUnread,
      },
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(server.id),
      },
      {
        label: "Leave Server",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => alert("Leave server not implemented yet"),
        variant: "danger",
      },
    ]);
  };

  const { visibleDms, overflowCount } = useMemo(() => {
    if (dmExpanded || unreadDms.length <= MAX_VISIBLE_DMS) {
      return { visibleDms: unreadDms, overflowCount: 0 };
    }

    return {
      visibleDms: unreadDms.slice(0, MAX_VISIBLE_DMS),
      overflowCount: unreadDms.length - MAX_VISIBLE_DMS,
    };
  }, [unreadDms, dmExpanded]);

  const serverVoiceSummaries = useMemo(() => {
    return servers.reduce<Record<string, ServerVoiceSummary>>((acc, server) => {
      const serverChannels = channelsByServerId[server.id] ?? channels.filter((channel) => channel.server_id === server.id);
      const activeChannels = serverChannels
        .filter((channel) => channel.channel_type === "voice" && (voiceChannelStates[channel.id]?.length ?? 0) > 0)
        .sort((left, right) => left.position - right.position)
        .map((channel) => ({
          channelId: channel.id,
          channelName: channel.name,
          members: voiceChannelStates[channel.id] ?? [],
        }));

      if (activeChannels.length === 0) {
        return acc;
      }

      acc[server.id] = {
        activeChannels,
        totalMembers: activeChannels.reduce((total, channel) => total + channel.members.length, 0),
      };
      return acc;
    }, {});
  }, [servers, channelsByServerId, channels, voiceChannelStates]);

  const hasDmSection = unreadDms.length > 0;

  return (
    <TooltipProvider delayDuration={80}>
      <div
        className="relative z-100 flex h-full w-full flex-col items-center gap-2 overflow-y-auto bg-rm-bg-floating pt-3 no-scrollbar"
        style={{
          paddingTop: "calc(12px + var(--safe-area-top, 0px))",
          paddingBottom: "calc(12px + var(--safe-area-bottom, 0px))",
        }}
      >
      <div className="group relative flex w-full justify-center">
        <button
          className={cn(
            "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] bg-rm-bg-elevated text-rm-text-primary transition-all duration-300 hover:rounded-[16px] hover:bg-primary hover:text-primary-foreground",
            activeServerId === "@me" && "rounded-[16px] bg-primary text-primary-foreground shadow-[0_0_20px_var(--rm-glow)]",
          )}
          onClick={() => onSelect("@me")}
          aria-label="Direct messages"
        >
          <HomeIcon className="h-7 w-7" />
          {homeBadgeCount > 0 && (
            <div className="pointer-events-none absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-[3px] ring-rm-bg-floating animate-in zoom-in duration-200">
              {homeBadgeCount > 99 ? "99+" : homeBadgeCount}
            </div>
          )}
        </button>
        <div
          className={cn(
            "absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-rm-text transition-all duration-300",
            activeServerId === "@me" ? "h-10" : "h-0 group-hover:h-5",
          )}
        />
      </div>

      {hasDmSection && (
        <>
          <div className="mx-auto h-[2px] w-8 rounded-full bg-rm-border" />

          {visibleDms.map((dm) => {
            const isActiveDm = activeServerId === "@me" && activeChannelId === dm.channelId;
            const displayName = getDisplayName(dm.recipient);

            return (
              <div key={dm.channelId} className="group relative flex w-full justify-center animate-in fade-in slide-in-from-left-2 duration-300">
                <button
                  className={cn(
                    "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-full transition-all duration-300",
                    isActiveDm
                      ? "ring-2 ring-primary shadow-[0_0_20px_var(--rm-glow)]"
                      : "ring-1 ring-white/10 hover:ring-white/30",
                  )}
                  onClick={() => onSelectDm?.(dm.channelId)}
                >
                  {dm.recipient.avatar_url ? (
                    <img
                      src={getAuthAssetUrl(dm.recipient.avatar_url)}
                      alt={displayName}
                      className="h-full w-full rounded-[inherit] object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-[inherit] bg-rm-bg-elevated text-sm font-bold text-rm-text">
                      {getDisplayInitial(dm.recipient)}
                    </div>
                  )}
                  <div className="pointer-events-none fixed left-[80px] z-150 hidden whitespace-nowrap rounded border border-rm-border bg-rm-bg-floating px-2 py-1 text-xs font-medium text-rm-text opacity-0 shadow-xl transition-opacity group-hover:opacity-100 md:block">
                    {displayName}
                  </div>
                  {(dm.unreadCount ?? 1) > 0 && (
                    <div className="pointer-events-none absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-[3px] ring-rm-bg-floating">
                      {(dm.unreadCount ?? 1) > 99 ? "99+" : (dm.unreadCount ?? 1)}
                    </div>
                  )}
                </button>
                <div
                  className={cn(
                    "absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-rm-text transition-all duration-300",
                    isActiveDm ? "h-10" : "h-2 group-hover:h-5",
                  )}
                />
              </div>
            );
          })}

          {overflowCount > 0 && (
            <button
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-rm-bg-elevated text-[11px] font-bold text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text"
              onClick={() => setDmExpanded(true)}
            >
              +{overflowCount}
            </button>
          )}

          {dmExpanded && unreadDms.length > MAX_VISIBLE_DMS && (
            <button
              className="flex h-6 w-10 cursor-pointer items-center justify-center rounded-full bg-rm-bg-elevated text-[10px] font-medium text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text"
              onClick={() => setDmExpanded(false)}
            >
              Less
            </button>
          )}
        </>
      )}

      <div className="mx-auto h-[2px] w-8 rounded-full bg-rm-border" />

      {servers.map((server) => {
        const isActive = activeServerId === server.id;
        const hasUnread = !isActive && serverHasUnread(server.id, channels, readStates, lastMessageAt);
        const mentionCount = serverMentionCounts[server.id] ?? 0;
        const voiceSummary = serverVoiceSummaries[server.id];
        const isInLocalVoiceServer = !!voiceSummary && localVoiceServerId === server.id;
        const visibleVoiceChannels = voiceSummary?.activeChannels.slice(0, MAX_VISIBLE_VOICE_CHANNELS) ?? [];
        const hiddenVoiceChannelCount = Math.max(0, (voiceSummary?.activeChannels.length ?? 0) - visibleVoiceChannels.length);
        const visibleVoiceChannelNames = visibleVoiceChannels.map((channel) => channel.channelName).join(", ");
        const buttonLabel = voiceSummary
          ? `${server.name}, ${formatVoiceSummary(voiceSummary.totalMembers, voiceSummary.activeChannels.length)}, active voice: ${visibleVoiceChannelNames}${hiddenVoiceChannelCount > 0 ? `, and ${hiddenVoiceChannelCount} more` : ""}`
          : server.name;

        return (
          <div key={server.id} className="group relative flex w-full justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] font-bold transition-all duration-300 hover:rounded-[16px]",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-[0_0_20px_var(--rm-glow)]"
                      : "bg-rm-bg-elevated text-rm-text hover:bg-primary hover:text-primary-foreground",
                  )}
                  onClick={() => onSelect(server.id)}
                  onContextMenu={(event) => handleServerContextMenu(event, server)}
                  aria-label={buttonLabel}
                  data-server-tooltip={voiceSummary ? "voice" : "label"}
                >
                  {server.icon_url ? (
                    <img
                      src={getAuthAssetUrl(server.icon_url)}
                      alt={server.name}
                      className="h-full w-full rounded-[inherit] object-cover"
                    />
                  ) : (
                    server.name.charAt(0).toUpperCase()
                  )}

                  {voiceSummary && (
                    <div
                      data-server-voice-indicator="true"
                      data-local-voice={isInLocalVoiceServer ? "true" : "false"}
                      className={cn(
                        "pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.28)] ring-[3px] ring-rm-bg-floating transition-colors",
                        isInLocalVoiceServer
                          ? "border-primary/40 bg-primary text-primary-foreground"
                          : "border-rm-border bg-rm-bg-elevated text-rm-text-secondary",
                      )}
                    >
                      <Volume2 className="h-3 w-3" />
                    </div>
                  )}

                  {mentionCount > 0 && (
                    <div className="pointer-events-none absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-[3px] ring-rm-bg-floating animate-in zoom-in duration-200">
                      {mentionCount > 99 ? "99+" : mentionCount}
                    </div>
                  )}
                </button>
              </TooltipTrigger>

              <TooltipContent
                forceMount
                side="right"
                align="center"
                sideOffset={14}
                data-server-tooltip={voiceSummary ? "voice" : "label"}
                className={cn(
                  "border-rm-border bg-rm-bg-floating text-rm-text shadow-2xl",
                  voiceSummary
                    ? "w-[248px] max-w-[calc(100vw-112px)] rounded-2xl px-0 py-0"
                    : "rounded-lg px-2 py-1 text-xs font-medium",
                )}
              >
                {voiceSummary ? (
                  <div className="p-3">
                    <p className="truncate text-sm font-semibold">{server.name}</p>
                    <p className="mt-1 text-[11px] font-medium text-rm-text-muted">
                      {formatVoiceSummary(voiceSummary.totalMembers, voiceSummary.activeChannels.length)}
                    </p>

                    <div className="mt-3 space-y-2">
                      {visibleVoiceChannels.map((channel) => {
                        const visibleMembers = channel.members.slice(0, MAX_VISIBLE_VOICE_AVATARS);
                        const hiddenMemberCount = Math.max(0, channel.members.length - visibleMembers.length);

                        return (
                          <div
                            key={channel.channelId}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-rm-bg-elevated px-2.5 py-2"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Volume2 className="h-3.5 w-3.5 shrink-0 text-rm-text-secondary" />
                                <span className="truncate text-xs font-semibold">{channel.channelName}</span>
                              </div>
                              <p className="mt-1 text-[11px] text-rm-text-muted">
                                {channel.members.length === 1 ? "1 person" : `${channel.members.length} people`}
                              </p>
                            </div>

                            <div className="flex items-center">
                              {visibleMembers.map((member, index) => {
                                const displayName = getDisplayName(member, member.name);
                                return (
                                  <div
                                    key={`${channel.channelId}-${member.clerk_user_id}`}
                                    className={cn(
                                      "flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-rm-bg-floating bg-rm-bg-secondary text-[10px] font-semibold text-rm-text",
                                      index > 0 && "-ml-2",
                                    )}
                                  >
                                    {member.avatar_url ? (
                                      <img
                                        src={getAuthAssetUrl(member.avatar_url)}
                                        alt={displayName}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      getDisplayInitial(member, "?")
                                    )}
                                  </div>
                                );
                              })}

                              {hiddenMemberCount > 0 && (
                                <div className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border border-rm-bg-floating bg-rm-bg-secondary text-[10px] font-semibold text-rm-text-secondary">
                                  +{hiddenMemberCount}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {hiddenVoiceChannelCount > 0 && (
                        <p className="text-[11px] font-medium text-rm-text-muted">
                          {formatMoreChannels(hiddenVoiceChannelCount)}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  server.name
                )}
              </TooltipContent>
            </Tooltip>

            <div
              className={cn(
                "absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-rm-text transition-all duration-300",
                isActive ? "h-10" : hasUnread ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5",
              )}
            />
          </div>
        );
      })}

      <button
        className="group relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] bg-rm-bg-elevated text-rm-text-primary transition-all duration-300 hover:rounded-[16px] hover:bg-primary hover:text-primary-foreground"
        onClick={() => setShowCreate(true)}
        aria-label="Create server"
      >
        <Plus className="h-6 w-6" />
      </button>

        {showCreate && <CreateServerModal onClose={() => setShowCreate(false)} />}

        {menu.isOpen && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={closeMenu}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
