import { getAuthAssetUrl } from "@/lib/platform";
import type { Channel, Server, User } from "@/lib/types";
import { Command } from "cmdk";
import { Hash, MessageSquare, Mic, MicOff, Moon, Server as ServerIcon, Sun, Volume2, VolumeX } from "lucide-react";

export function CommandMenuServersGroup({
  servers,
  navigateToServer,
}: {
  servers: Server[];
  navigateToServer: (id: string) => void;
}) {
  if (servers.length === 0) return null;

  return (
    <Command.Group
      heading="Servers"
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
    >
      {servers.map((server) => (
        <Command.Item
          key={server.id}
          value={`server ${server.name}`}
          onSelect={() => navigateToServer(server.id)}
          className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--rm-bg-elevated)] text-[10px] font-bold overflow-hidden">
            {server.icon_url ? (
              <img src={getAuthAssetUrl(server.icon_url)} alt="" className="h-full w-full object-cover" />
            ) : (
              server.name.charAt(0).toUpperCase()
            )}
          </div>
          <span>{server.name}</span>
          <ServerIcon className="ml-auto h-3.5 w-3.5 text-[var(--rm-text-ghost)]" />
        </Command.Item>
      ))}
    </Command.Group>
  );
}

export function CommandMenuTextChannelsGroup({
  channels,
  serverMap,
  navigateToChannel,
}: {
  channels: Channel[];
  serverMap: Map<string, string>;
  navigateToChannel: (serverId: string, channelId: string) => void;
}) {
  if (channels.length === 0) return null;

  return (
    <Command.Group
      heading="Text Channels"
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
    >
      {channels.map((channel) => (
        <Command.Item
          key={channel.id}
          value={`channel ${channel.name} ${serverMap.get(channel.server_id!) ?? ""}`}
          onSelect={() => navigateToChannel(channel.server_id!, channel.id)}
          className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
        >
          <Hash className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
          <span>{channel.name}</span>
          <span className="ml-auto text-xs text-[var(--rm-text-ghost)]">
            {serverMap.get(channel.server_id!) ?? ""}
          </span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}

export function CommandMenuVoiceChannelsGroup({
  channels,
  serverMap,
  navigateToChannel,
}: {
  channels: Channel[];
  serverMap: Map<string, string>;
  navigateToChannel: (serverId: string, channelId: string) => void;
}) {
  if (channels.length === 0) return null;

  return (
    <Command.Group
      heading="Voice Channels"
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
    >
      {channels.map((channel) => (
        <Command.Item
          key={channel.id}
          value={`voice ${channel.name} ${serverMap.get(channel.server_id!) ?? ""}`}
          onSelect={() => navigateToChannel(channel.server_id!, channel.id)}
          className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
        >
          <Volume2 className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
          <span>{channel.name}</span>
          <span className="ml-auto text-xs text-[var(--rm-text-ghost)]">
            {serverMap.get(channel.server_id!) ?? ""}
          </span>
        </Command.Item>
      ))}
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
    <Command.Group
      heading="Direct Messages"
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
    >
      {dmChannels.map((dm) => {
        const displayName = dm.recipient?.display_name?.trim() || dm.recipient?.username || dm.name;
        return (
          <Command.Item
            key={dm.id}
            value={`dm ${displayName} ${dm.recipient?.username ?? ""}`}
            onSelect={() => navigateToDm(dm.id)}
            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
          >
            <div className="h-5 w-5 rounded-full bg-[var(--rm-bg-elevated)] overflow-hidden flex items-center justify-center shrink-0">
              {dm.recipient?.avatar_url ? (
                <img src={getAuthAssetUrl(dm.recipient.avatar_url)} alt="" className="h-full w-full object-cover" />
              ) : (
                <MessageSquare className="h-3 w-3 text-[var(--rm-text-muted)]" />
              )}
            </div>
            <span>{displayName}</span>
          </Command.Item>
        );
      })}
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
  setTheme: (theme: string) => void;
  setOpen: (open: boolean) => void;
}) {
  return (
    <Command.Group
      heading="Actions"
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
    >
      <Command.Item
        value="toggle mute microphone"
        onSelect={() => {
          setIsMuted(!isMuted);
          setOpen(false);
        }}
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
      >
        {isMuted ? (
          <MicOff className="h-4 w-4 shrink-0 text-[var(--destructive)]" />
        ) : (
          <Mic className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
        )}
        <span>{isMuted ? "Unmute Microphone" : "Mute Microphone"}</span>
      </Command.Item>

      <Command.Item
        value="toggle deafen audio"
        onSelect={() => {
          setIsDeafened(!isDeafened);
          setOpen(false);
        }}
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
      >
        {isDeafened ? (
          <VolumeX className="h-4 w-4 shrink-0 text-[var(--destructive)]" />
        ) : (
          <Volume2 className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
        )}
        <span>{isDeafened ? "Undeafen" : "Deafen"}</span>
      </Command.Item>

      <Command.Item
        value="toggle theme dark light mode"
        onSelect={() => {
          setTheme(theme === "dark" ? "light" : "dark");
          setOpen(false);
        }}
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
        ) : (
          <Moon className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
        )}
        <span>Switch to {theme === "dark" ? "Light" : "Dark"} Mode</span>
      </Command.Item>
    </Command.Group>
  );
}
