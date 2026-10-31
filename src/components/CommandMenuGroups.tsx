import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { MiniAvatar } from "@/components/chat/MiniAvatar";
import {
  normalizeUserStatus,
  UserStatusDot,
} from "@/components/chat/UserStatusDot";
import { CountBadge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/kbd";
import { MENU_ITEM } from "@/components/ui/menu";
import { getChannelIcon } from "@/lib/channel-icon";
import { getAuthAssetUrl } from "@/lib/platform";
import type { AppTheme } from "@/lib/theme-preferences";
import type { Channel, Server, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Command } from "cmdk";
import type { ReactNode } from "react";
import { commandValue, SEARCH_MESSAGES_VALUE } from "./command-menu-filter";

/**
 * Menu row (spec §7): 32 high, radius 6, a 20px leading slot (16px glyphs,
 * 20px avatars and server tiles), text-ui-sm 500. The highlight is tint-2 and
 * changes instantly: the switcher is used many times a day.
 */
const ROW = cn(
  MENU_ITEM,
  "group/item h-8 cursor-pointer py-0 text-ink-1 aria-selected:bg-tint-2",
);

/** Sentence-case group labels (MENU_LABEL); groups sit 4px apart. */
const GROUP =
  "not-first:mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-ui-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3";

/** Shown on the highlighted row, and only where there is a keyboard. */
function EnterHint() {
  return (
    <Kbd
      aria-hidden="true"
      className="ml-2 hidden shrink-0 pointer-fine:group-aria-selected/item:inline-flex"
    >
      ↵
    </Kbd>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return (
    <span className="ms-auto min-w-0 shrink truncate pl-3 text-ui-xs font-normal text-ink-3">
      {children}
    </span>
  );
}

/** The 20px leading slot with a 16px glyph. */
function GlyphSlot({
  icon,
  className,
  children,
}: {
  icon?: IconName;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center text-ink-3 group-aria-selected/item:text-ink-2",
        className,
      )}
    >
      {icon ? <Icon name={icon} size="sm" /> : children}
    </span>
  );
}

function Name({ text }: { text: string }) {
  return (
    <span className="min-w-0 truncate">
      <InlineEmojiText text={text} />
    </span>
  );
}

function serverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

function ServerIcon({
  server,
  className,
}: {
  server: Pick<Server, "name" | "icon_url">;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-xs bg-tint-2 text-ui-2xs font-semibold text-ink-2",
        className,
      )}
    >
      {server.icon_url ? (
        <img
          src={getAuthAssetUrl(server.icon_url)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        serverInitials(server.name)
      )}
    </span>
  );
}

// ── Rows ───────────────────────────────────────────────────────────────────
// Shared by the kind groups and the idle Recent / Unread groups. `tag` keeps
// cmdk values unique when the same place shows in two groups.

export type CommandDm = { id: string; name: string; recipient: User };

function dmName(dm: CommandDm): string {
  return (
    dm.recipient?.display_name?.trim() || dm.recipient?.username || dm.name
  );
}

function CommandDmRow({
  dm,
  onSelect,
  tag,
  badge = 0,
}: {
  dm: CommandDm;
  onSelect: (id: string) => void;
  tag?: string;
  badge?: number;
}) {
  const recipient = dm.recipient;
  const displayName = dmName(dm);
  return (
    <Command.Item
      value={commandValue(
        "dm",
        displayName,
        recipient?.username ?? dm.id,
        tag ?? "",
      )}
      onSelect={() => onSelect(dm.id)}
      className={ROW}
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <MiniAvatar
          avatarUrl={recipient?.avatar_url}
          avatarDisplay={recipient?.avatar_display}
          displayName={displayName}
          username={recipient?.username}
          size={20}
        />
        <UserStatusDot
          status={normalizeUserStatus(recipient?.status)}
          ring="bg-ply-3"
          className="absolute -right-1 -bottom-1 size-3"
        />
      </span>
      <Name text={displayName} />
      {badge > 0 ? (
        <CountBadge count={badge} className="ms-auto" />
      ) : (
        recipient?.username && <Meta>@{recipient.username}</Meta>
      )}
      <EnterHint />
    </Command.Item>
  );
}

function CommandChannelRow({
  channel,
  kind,
  server,
  onSelect,
  tag,
  badge = 0,
}: {
  channel: Channel;
  kind: "channel" | "voice";
  /** Shown as meta; pass undefined when the user is in one server. */
  server?: Server;
  onSelect: (serverId: string, channelId: string) => void;
  tag?: string;
  badge?: number;
}) {
  return (
    <Command.Item
      value={commandValue(kind, channel.name, server?.name ?? "", tag ?? "")}
      onSelect={() => onSelect(channel.server_id!, channel.id)}
      className={ROW}
    >
      <GlyphSlot icon={getChannelIcon(channel)} />
      <Name text={channel.name} />
      {badge > 0 ? (
        <CountBadge count={badge} className="ms-auto" />
      ) : (
        server && (
          <Meta>
            <InlineEmojiText text={server.name} />
          </Meta>
        )
      )}
      <EnterHint />
    </Command.Item>
  );
}

// ── Groups ─────────────────────────────────────────────────────────────────

export function CommandMenuServersGroup({
  servers,
  activeServerId,
  navigateToServer,
}: {
  servers: Server[];
  activeServerId: string | null;
  navigateToServer: (id: string) => void;
}) {
  if (servers.length === 0) return null;
  return (
    <Command.Group heading="Servers" className={GROUP}>
      {servers.map((server) => (
        <Command.Item
          key={server.id}
          value={commandValue("server", server.name)}
          onSelect={() => navigateToServer(server.id)}
          className={ROW}
        >
          <ServerIcon server={server} />
          <Name text={server.name} />
          {server.id === activeServerId && <Meta>Current</Meta>}
          <EnterHint />
        </Command.Item>
      ))}
    </Command.Group>
  );
}

export function CommandMenuChannelsGroup({
  heading,
  kind,
  channels,
  serverMap,
  showServer,
  navigateToChannel,
}: {
  heading: string;
  kind: "channel" | "voice";
  channels: Channel[];
  serverMap: Map<string, Server>;
  /** Server names as meta; off when the user is in one server. */
  showServer: boolean;
  navigateToChannel: (serverId: string, channelId: string) => void;
}) {
  if (channels.length === 0) return null;
  return (
    <Command.Group heading={heading} className={GROUP}>
      {channels.map((channel) => (
        <CommandChannelRow
          key={channel.id}
          channel={channel}
          kind={kind}
          server={
            showServer && channel.server_id
              ? serverMap.get(channel.server_id)
              : undefined
          }
          onSelect={navigateToChannel}
        />
      ))}
    </Command.Group>
  );
}

export function CommandMenuDMsGroup({
  dmChannels,
  navigateToDm,
}: {
  dmChannels: CommandDm[];
  navigateToDm: (id: string) => void;
}) {
  if (dmChannels.length === 0) return null;
  return (
    <Command.Group heading="Direct messages" className={GROUP}>
      {dmChannels.map((dm) => (
        <CommandDmRow key={dm.id} dm={dm} onSelect={navigateToDm} />
      ))}
    </Command.Group>
  );
}

/** One place in the idle Recent / Unread groups. */
export type CommandPlace =
  | { kind: "dm"; dm: CommandDm; badge?: number }
  | {
      kind: "channel" | "voice";
      channel: Channel;
      server?: Server;
      badge?: number;
    };

export function CommandMenuPlacesGroup({
  heading,
  tag,
  places,
  navigateToDm,
  navigateToChannel,
}: {
  heading: string;
  tag: string;
  places: CommandPlace[];
  navigateToDm: (id: string) => void;
  navigateToChannel: (serverId: string, channelId: string) => void;
}) {
  if (places.length === 0) return null;
  return (
    <Command.Group heading={heading} className={GROUP}>
      {places.map((place) =>
        place.kind === "dm" ? (
          <CommandDmRow
            key={place.dm.id}
            dm={place.dm}
            tag={tag}
            badge={place.badge}
            onSelect={navigateToDm}
          />
        ) : (
          <CommandChannelRow
            key={place.channel.id}
            channel={place.channel}
            kind={place.kind}
            server={place.server}
            tag={tag}
            badge={place.badge}
            onSelect={navigateToChannel}
          />
        ),
      )}
    </Command.Group>
  );
}

export function CommandMenuSearchItem({
  query,
  scopeLabel,
  onSelect,
}: {
  query: string;
  scopeLabel: string;
  onSelect: () => void;
}) {
  return (
    <Command.Group heading="Messages" className={GROUP} forceMount>
      <Command.Item
        value={`${SEARCH_MESSAGES_VALUE} ${query}`}
        forceMount
        onSelect={onSelect}
        className={cn(ROW, "text-ink-2")}
      >
        <GlyphSlot icon="search" />
        <span className="min-w-0 truncate">
          Search {scopeLabel} for <span className="text-ink-1">“{query}”</span>
        </span>
        <EnterHint />
      </Command.Item>
    </Command.Group>
  );
}

export function CommandMenuActionsGroup({
  isMuted,
  setIsMuted,
  isDeafened,
  setIsDeafened,
  theme,
  setTheme,
  setOpen,
}: {
  isMuted: boolean;
  setIsMuted: (val: boolean) => void;
  isDeafened: boolean;
  setIsDeafened: (val: boolean) => void;
  theme: string | undefined;
  setTheme: (theme: AppTheme) => void | Promise<void>;
  setOpen: (open: boolean) => void;
}) {
  return (
    <Command.Group heading="Actions" className={GROUP}>
      <Command.Item
        value={commandValue("action", "toggle mute microphone")}
        onSelect={() => {
          setIsMuted(!isMuted);
          setOpen(false);
        }}
        className={ROW}
      >
        <GlyphSlot
          className={cn(
            isMuted &&
              "text-muted-state group-aria-selected/item:text-muted-state",
          )}
        >
          <Icon name="mic" state={isMuted ? "off" : "idle"} size="sm" />
        </GlyphSlot>
        <span>{isMuted ? "Unmute microphone" : "Mute microphone"}</span>
        <EnterHint />
      </Command.Item>
      <Command.Item
        value={commandValue("action", "toggle deafen audio")}
        onSelect={() => {
          setIsDeafened(!isDeafened);
          setOpen(false);
        }}
        className={ROW}
      >
        <GlyphSlot
          className={cn(
            isDeafened &&
              "text-muted-state group-aria-selected/item:text-muted-state",
          )}
        >
          <Icon name="deafen" state={isDeafened ? "off" : "idle"} size="sm" />
        </GlyphSlot>
        <span>{isDeafened ? "Undeafen" : "Deafen"}</span>
        <EnterHint />
      </Command.Item>
      <Command.Item
        value={commandValue("action", "toggle theme dark light mode")}
        onSelect={() => {
          void setTheme(theme === "dark" ? "light" : "dark");
          setOpen(false);
        }}
        className={ROW}
      >
        <GlyphSlot icon={theme === "dark" ? "sun" : "moon"} />
        <span>Switch to {theme === "dark" ? "light" : "dark"} mode</span>
        <EnterHint />
      </Command.Item>
    </Command.Group>
  );
}
