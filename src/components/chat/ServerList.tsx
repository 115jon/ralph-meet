import { toContextMenuEvent, useLongPress } from "@/hooks/useLongPress";
import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { useContextMenu } from "@/hooks/useContextMenu";
import { getAuthAssetUrl } from "@/lib/platform";
import type { VoiceChannelMember } from "@/lib/chat-reducer";
import type { Channel, Server, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HIT, PRESS, PRESS_ICON } from "@/components/ui/interaction";
import { CountBadge } from "@/components/ui/badge";
import { copyToClipboard } from "@/components/ui/toast";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ContextMenu from "./ContextMenu";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import CreateServerModal from "./CreateServerModal";
import { HomeIcon } from "./HomeIcon";
import InlineEmojiText from "./InlineEmojiText";

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
  recipient: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_display?: User["avatar_display"];
  };
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
  const serverChannels = channels.filter(
    (channel) => channel.server_id === serverId,
  );
  return serverChannels.some((channel) => {
    const lastMessage = lastMessageAt[channel.id];
    if (!lastMessage) return false;
    const lastRead = readStates[channel.id];
    if (!lastRead) return true;
    return lastMessage > lastRead;
  });
}

function formatVoiceSummary(
  totalMembers: number,
  activeChannelCount: number,
): string {
  const peopleLabel =
    totalMembers === 1 ? "1 person" : `${totalMembers} people`;
  const channelLabel =
    activeChannelCount === 1 ? "1 channel" : `${activeChannelCount} channels`;
  return `${peopleLabel} across ${channelLabel}`;
}

function formatMoreChannels(count: number): string {
  return count === 1
    ? "+1 more active voice channel"
    : `+${count} more active voice channels`;
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
  onMarkAllRead: _onMarkAllRead,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const shouldRenderCreateServer = showCreate;
  const [dmExpanded, setDmExpanded] = useState(false);
  const { menu, openMenu, closeMenu, shouldRender, isClosing } =
    useContextMenu();

  const handleServerContextMenu = (event: React.MouseEvent, server: Server) => {
    const hasUnread = serverHasUnread(
      server.id,
      channels,
      readStates,
      lastMessageAt,
    );
    openMenu(event, [
      {
        label: "Mark as read",
        icon: <Icon name="check" size="sm" />,
        onClick: () => onMarkServerRead?.(server.id),
        disabled: !hasUnread,
      },
      {
        label: "Copy ID",
        icon: <Icon name="copy" size="sm" />,
        onClick: () => void copyToClipboard(server.id, "Server ID copied"),
      },
      // "Leave server" returns once the API exists (FINAL-FIX-ROUND blocker 3).
    ]);
  };

  const bindServerLongPress = useLongPress<Server>((info, server) =>
    handleServerContextMenu(toContextMenuEvent(info), server),
  );

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
      const serverChannels =
        channelsByServerId[server.id] ??
        channels.filter((channel) => channel.server_id === server.id);
      const activeChannels = serverChannels
        .filter(
          (channel) =>
            channel.channel_type === "voice" &&
            (voiceChannelStates[channel.id]?.length ?? 0) > 0,
        )
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
        totalMembers: activeChannels.reduce(
          (total, channel) => total + channel.members.length,
          0,
        ),
      };
      return acc;
    }, {});
  }, [servers, channelsByServerId, channels, voiceChannelStates]);

  const hasDmSection = unreadDms.length > 0;

  return (
    <TooltipProvider>
      <div
        className="relative z-10 flex h-full w-full flex-col items-center gap-2 overflow-y-auto bg-ply-0 scrollbar-none"
        style={{
          paddingTop: "calc(12px + var(--safe-area-top, 0px))",
          paddingBottom: "calc(12px + var(--safe-area-bottom, 0px))",
        }}
      >
        <RailSlot pill={activeServerId === "@me" ? "selected" : "none"}>
          <button
            type="button"
            className={cn(
              RAIL_TILE,
              // The home mark is a two-tone image that swaps on dark/light,
              // so Home lifts to tint-3 instead of the primary key (the art
              // would vanish on primary-fill).
              "bg-tint-2 text-ink-1",
              activeServerId === "@me" && "bg-tint-3",
            )}
            onClick={() => onSelect("@me")}
            aria-label="Direct messages"
            aria-current={activeServerId === "@me" ? "page" : undefined}
          >
            <HomeIcon className="size-6" />
            {homeBadgeCount > 0 && (
              <CountBadge
                count={homeBadgeCount}
                ring="ply-0"
                className={RAIL_BADGE}
              />
            )}
          </button>
        </RailSlot>

        {hasDmSection && (
          <>
            <div aria-hidden className={RAIL_RULE} />

            {visibleDms.map((dm) => {
              const isActiveDm =
                activeServerId === "@me" && activeChannelId === dm.channelId;
              const displayName = getDisplayName(dm.recipient);

              return (
                <RailSlot
                  key={dm.channelId}
                  pill={isActiveDm ? "selected" : "unread"}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          RAIL_TILE,
                          avatarShape(
                            dm.recipient.avatar_url &&
                              dm.recipient.avatar_display,
                            { clip: false },
                          ),
                          isActiveDm && RAIL_TILE_SELECTED,
                        )}
                        onClick={() => onSelectDm?.(dm.channelId)}
                        aria-label={displayName}
                      >
                        <span
                          className={cn(
                            "size-full",
                            avatarShape(
                              dm.recipient.avatar_url &&
                                dm.recipient.avatar_display,
                            ),
                          )}
                        >
                          {dm.recipient.avatar_url ? (
                            <AvatarImage
                              src={getAuthAssetUrl(dm.recipient.avatar_url)}
                              alt={displayName}
                              display={dm.recipient.avatar_display}
                            />
                          ) : (
                            <span className="flex size-full items-center justify-center">
                              {getDisplayInitial(dm.recipient)}
                            </span>
                          )}
                        </span>
                        {(dm.unreadCount ?? 1) > 0 && (
                          <CountBadge
                            count={dm.unreadCount ?? 1}
                            ring="ply-0"
                            // Over a decoration's ring art (z-10).
                            className={cn(RAIL_BADGE, "z-20")}
                          />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      forceMount
                      side="right"
                      align="center"
                      sideOffset={12}
                    >
                      <InlineEmojiText text={displayName} />
                    </TooltipContent>
                  </Tooltip>
                </RailSlot>
              );
            })}

            {overflowCount > 0 && (
              <button
                type="button"
                aria-label={`Show ${overflowCount} more unread conversations`}
                className={cn(RAIL_TILE, "font-sans text-num-xs")}
                onClick={() => setDmExpanded(true)}
              >
                +{overflowCount}
              </button>
            )}

            {dmExpanded && unreadDms.length > MAX_VISIBLE_DMS && (
              <button
                type="button"
                className={cn(
                  "flex h-6 w-10 items-center justify-center rounded-sm text-ui-xs font-medium text-ink-3 pointer-fine:hover:text-ink-1",
                  PRESS,
                  HIT,
                )}
                onClick={() => setDmExpanded(false)}
              >
                Less
              </button>
            )}
          </>
        )}

        <div
          aria-hidden
          className={hasDmSection ? RAIL_SEPARATOR : RAIL_RULE}
        />

        {servers.map((server) => {
          const isActive = activeServerId === server.id;
          const hasUnread =
            !isActive &&
            serverHasUnread(server.id, channels, readStates, lastMessageAt);
          const mentionCount = serverMentionCounts[server.id] ?? 0;
          const voiceSummary = serverVoiceSummaries[server.id];
          const isInLocalVoiceServer =
            !!voiceSummary && localVoiceServerId === server.id;
          const visibleVoiceChannels =
            voiceSummary?.activeChannels.slice(0, MAX_VISIBLE_VOICE_CHANNELS) ??
            [];
          const hiddenVoiceChannelCount = Math.max(
            0,
            (voiceSummary?.activeChannels.length ?? 0) -
              visibleVoiceChannels.length,
          );
          const visibleVoiceChannelNames = visibleVoiceChannels
            .map((channel) => channel.channelName)
            .join(", ");
          const buttonLabel = voiceSummary
            ? `${server.name}, ${formatVoiceSummary(voiceSummary.totalMembers, voiceSummary.activeChannels.length)}, active voice: ${visibleVoiceChannelNames}${hiddenVoiceChannelCount > 0 ? `, and ${hiddenVoiceChannelCount} more` : ""}`
            : server.name;

          return (
            <RailSlot
              key={server.id}
              pill={isActive ? "selected" : hasUnread ? "unread" : "none"}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      RAIL_TILE,
                      isActive && RAIL_TILE_SELECTED,
                      hasUnread && !isActive && "text-ink-1",
                      // You are here: your call's server wears the path.
                      isInLocalVoiceServer && "ring-1 ring-path ring-inset",
                    )}
                    onClick={() => onSelect(server.id)}
                    onContextMenu={(event) =>
                      handleServerContextMenu(event, server)
                    }
                    {...bindServerLongPress(server)}
                    aria-label={buttonLabel}
                    aria-current={isActive ? "page" : undefined}
                    data-server-tooltip={voiceSummary ? "voice" : "label"}
                  >
                    <span className="flex size-full shrink-0 items-center justify-center overflow-hidden rounded-[inherit]">
                      {server.icon_url ? (
                        <img
                          src={getAuthAssetUrl(server.icon_url)}
                          alt={server.name}
                          className="size-full object-cover"
                        />
                      ) : (
                        server.name.charAt(0).toUpperCase()
                      )}
                    </span>

                    {voiceSummary && (
                      <span
                        data-server-voice-indicator="true"
                        data-local-voice={
                          isInLocalVoiceServer ? "true" : "false"
                        }
                        className={cn(
                          "pointer-events-none absolute flex items-center justify-center rounded-full ring-2 ring-ply-0",
                          isInLocalVoiceServer
                            ? "-top-1 -right-1 size-4 bg-path text-ply-0"
                            : "-top-0.5 -right-0.5 size-2 bg-ink-3",
                        )}
                      >
                        {isInLocalVoiceServer && (
                          <Icon
                            name="speaking"
                            size="xs"
                            className="size-2.5"
                          />
                        )}
                      </span>
                    )}

                    {mentionCount > 0 && (
                      <CountBadge
                        count={mentionCount}
                        ring="ply-0"
                        className={RAIL_BADGE}
                      />
                    )}
                  </button>
                </TooltipTrigger>

                <TooltipContent
                  forceMount
                  side="right"
                  align="center"
                  sideOffset={12}
                  data-server-tooltip={voiceSummary ? "voice" : "label"}
                >
                  {voiceSummary ? (
                    <div className="flex flex-col gap-1.5 py-0.5">
                      <div>
                        <p className="truncate font-semibold">
                          <InlineEmojiText text={server.name} />
                        </p>
                        <p className="opacity-70">
                          {formatVoiceSummary(
                            voiceSummary.totalMembers,
                            voiceSummary.activeChannels.length,
                          )}
                        </p>
                      </div>
                      {visibleVoiceChannels.map((channel) => {
                        const names = channel.members
                          .slice(0, MAX_VISIBLE_VOICE_AVATARS)
                          .map((member) => getDisplayName(member, member.name));
                        const hiddenMemberCount = Math.max(
                          0,
                          channel.members.length - names.length,
                        );
                        return (
                          <div key={channel.channelId} className="min-w-0">
                            <p className="flex items-center gap-1.5">
                              <Icon
                                name="voiceChannel"
                                size="xs"
                                className="shrink-0 opacity-70"
                              />
                              <span className="min-w-0 truncate font-semibold">
                                <InlineEmojiText text={channel.channelName} />
                              </span>
                            </p>
                            <p className="truncate pl-4.5 opacity-70">
                              {names.join(", ")}
                              {hiddenMemberCount > 0
                                ? ` +${hiddenMemberCount}`
                                : ""}
                            </p>
                          </div>
                        );
                      })}
                      {hiddenVoiceChannelCount > 0 && (
                        <p className="opacity-70">
                          {formatMoreChannels(hiddenVoiceChannelCount)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <InlineEmojiText text={server.name} />
                  )}
                </TooltipContent>
              </Tooltip>
            </RailSlot>
          );
        })}

        <button
          type="button"
          className={cn(
            RAIL_TILE,
            "border-2 border-line-strong bg-transparent text-ink-2 pointer-fine:hover:text-ink-1",
          )}
          onClick={() => setShowCreate(true)}
          aria-label="Create server"
        >
          <Icon name="add" size="lg" />
        </button>

        <CreateServerModal
          open={shouldRenderCreateServer}
          onClose={() => setShowCreate(false)}
        />

        {shouldRender && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={closeMenu}
            isClosing={isClosing}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * Rail tile (component kit, Rail): a 40px square key with 2px corners, tint-1
 * on the ply-0 rail, a Bricolage 800 initial. Selected is the primary key
 * (primary-fill, on-primary). Hover and press are ink overlays (PRESS); the
 * shape never morphs.
 */
const RAIL_TILE = cn(
  "relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[2px] bg-tint-1 font-display-tuned text-[15px] leading-none font-extrabold text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  PRESS,
  PRESS_ICON,
);
const RAIL_TILE_SELECTED = "bg-primary-fill text-on-primary";
/** Count chips sit on the tile's bottom-right corner, cut from the rail ply. */
const RAIL_BADGE = "pointer-events-none absolute -right-1.5 -bottom-1.5";
/** The 2px ink rule under Home. */
const RAIL_RULE = "my-1 h-0.5 w-6 shrink-0 bg-ink-1";
/** Hairline between the unread DMs and the servers. */
const RAIL_SEPARATOR = "h-px w-6 shrink-0 bg-line";

type PillState = "selected" | "unread" | "none";

/**
 * One rail row and its pill: a single 4x32 bar on the left edge that scales
 * (scaleY) between 0, 8px unread, 16px hover and 32px selected, so the
 * motion stays on the compositor. The selected pill is the head of the lit
 * you-are-here path (--path).
 */
function RailSlot({
  pill,
  children,
}: {
  pill: PillState;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative flex w-full justify-center">
      {children}
      <span
        aria-hidden
        data-pill={pill}
        className={cn(
          "pointer-events-none absolute top-1/2 left-0 h-8 w-1 -translate-y-1/2 rounded-r-full transition-[scale] duration-(--dur-3) ease-out",
          pill === "selected"
            ? "scale-y-100 bg-path"
            : pill === "unread"
              ? "scale-y-25 bg-ink-1 pointer-fine:group-hover:scale-y-50"
              : "scale-y-0 bg-ink-2 pointer-fine:group-hover:scale-y-50",
        )}
      />
    </div>
  );
}
