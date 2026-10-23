import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { MiniAvatar } from "@/components/chat/MiniAvatar";
import { UserStatusDot } from "@/components/chat/UserStatusDot";
import { Icon, type IconName } from "@/components/ui/icon";
import { getChannelIcon } from "@/lib/channel-icon";
import { getAuthAssetUrl } from "@/lib/platform";
import type { AppTheme } from "@/lib/theme-preferences";
import type { Channel, Server, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Command } from "cmdk";
import type { ReactNode } from "react";
import { commandValue, SEARCH_MESSAGES_VALUE } from "./command-menu-filter";

/** Quiet Pro menu row; the highlight is tonal and changes instantly. */
const ROW =
  "group/item flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-ui-sm text-rm-text-secondary outline-none select-none pointer-coarse:min-h-12 aria-selected:bg-rm-tint-2 aria-selected:text-rm-text";

const GROUP =
  "not-first:mt-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-ui-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-rm-text-muted";

const KBD =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-rm-border-strong px-1 font-sans text-ui-2xs font-medium text-rm-text-muted";

/** Shown on the highlighted row, and only where there is a keyboard. */
function EnterHint() {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        KBD,
        "ml-2 hidden shrink-0 pointer-fine:group-aria-selected/item:inline-flex",
      )}
    >
      ↵
    </kbd>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto min-w-0 shrink truncate pl-3 text-ui-xs text-rm-text-muted">
      {children}
    </span>
  );
}

function GlyphBox({ icon }: { icon: IconName }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center text-rm-text-muted group-aria-selected/item:text-rm-text-secondary"
    >
      <Icon name={icon} size="md" />
    </span>
  );
}

function serverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

export function ServerIcon({
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
        "flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-rm-tint-2 text-[9px] font-semibold text-rm-text-secondary",
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
          <span className="min-w-0 truncate font-medium">
            <InlineEmojiText text={server.name} />
          </span>
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
  navigateToChannel,
}: {
  heading: string;
  kind: "channel" | "voice";
  channels: Channel[];
  serverMap: Map<string, Server>;
  navigateToChannel: (serverId: string, channelId: string) => void;
}) {
  if (channels.length === 0) return null;
  return (
    <Command.Group heading={heading} className={GROUP}>
      {channels.map((channel) => {
        const server = channel.server_id
          ? serverMap.get(channel.server_id)
          : undefined;
        return (
          <Command.Item
            key={channel.id}
            value={commandValue(kind, channel.name, server?.name ?? "")}
            onSelect={() => navigateToChannel(channel.server_id!, channel.id)}
            className={ROW}
          >
            <GlyphBox icon={getChannelIcon(channel)} />
            <span className="min-w-0 truncate font-medium">
              <InlineEmojiText text={channel.name} />
            </span>
            {server && (
              <Meta>
                <InlineEmojiText text={server.name} />
              </Meta>
            )}
            <EnterHint />
          </Command.Item>
        );
      })}
    </Command.Group>
  );
}

export function CommandMenuDMsGroup({
  dmChannels,
  navigateToDm,
}: {
  dmChannels: Array<{ id: string; name: string; recipient: User }>;
  navigateToDm: (id: string) => void;
}) {
  if (dmChannels.length === 0) return null;
  return (
    <Command.Group heading="Direct messages" className={GROUP}>
      {dmChannels.map((dm) => {
        const recipient = dm.recipient;
        const displayName =
          recipient?.display_name?.trim() || recipient?.username || dm.name;
        const status = recipient?.status ?? "offline";
        return (
          <Command.Item
            key={dm.id}
            value={commandValue(
              "dm",
              displayName,
              recipient?.username ?? dm.id,
            )}
            onSelect={() => navigateToDm(dm.id)}
            className={ROW}
          >
            <span className="relative shrink-0">
              <MiniAvatar
                avatarUrl={recipient?.avatar_url}
                avatarDisplay={recipient?.avatar_display}
                displayName={displayName}
                username={recipient?.username}
                size={24}
              />
              <UserStatusDot
                status={status}
                className="absolute -right-0.5 -bottom-0.5 size-2.5 ring-2 ring-rm-bg-surface dark:ring-rm-bg-elevated"
              />
            </span>
            <span className="min-w-0 truncate font-medium">
              <InlineEmojiText text={displayName} />
            </span>
            {recipient?.username && <Meta>@{recipient.username}</Meta>}
            <EnterHint />
          </Command.Item>
        );
      })}
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
        className={ROW}
      >
        <GlyphBox icon="search" />
        <span className="min-w-0 truncate">
          Search {scopeLabel} for{" "}
          <span className="font-medium text-rm-text">“{query}”</span>
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
        <span
          aria-hidden="true"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            isMuted ? "text-rm-danger-ink" : "text-rm-text-muted",
          )}
        >
          <Icon name="mic" state={isMuted ? "off" : "idle"} size="md" />
        </span>
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
        <span
          aria-hidden="true"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            isDeafened ? "text-rm-danger-ink" : "text-rm-text-muted",
          )}
        >
          <Icon name="deafen" state={isDeafened ? "off" : "idle"} size="md" />
        </span>
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
        <GlyphBox icon={theme === "dark" ? "sun" : "moon"} />
        <span>Switch to {theme === "dark" ? "light" : "dark"} mode</span>
        <EnterHint />
      </Command.Item>
    </Command.Group>
  );
}

export { KBD as COMMAND_KBD };
