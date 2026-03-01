
import { useContextMenu } from "@/hooks/useContextMenu";
import type { Channel, Server } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useState } from "react";
import ContextMenu from "./ContextMenu";
import CreateServerModal from "./CreateServerModal";
import { HomeIcon } from "./HomeIcon";
import { Copy, Plus, Trash2 } from "./Icons";

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_OBJECT = {};

interface Props {
  servers: Server[];
  activeServerId: string | null;
  onSelect: (serverId: string) => void;
  channels?: Channel[];
  readStates?: Record<string, string>;
  lastMessageAt?: Record<string, string>;
}

function serverHasUnread(
  serverId: string,
  channels: Channel[],
  readStates: Record<string, string>,
  lastMessageAt: Record<string, string>
): boolean {
  const serverChannels = channels.filter((c) => c.server_id === serverId);
  return serverChannels.some((ch) => {
    const lastMsg = lastMessageAt[ch.id];
    if (!lastMsg) return false;
    const lastRead = readStates[ch.id];
    if (!lastRead) return true;
    return lastMsg > lastRead;
  });
}

export default function ServerList({
  servers,
  activeServerId,
  onSelect,
  channels = EMPTY_CHANNELS,
  readStates = EMPTY_OBJECT,
  lastMessageAt = EMPTY_OBJECT,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const handleServerContextMenu = (e: React.MouseEvent, server: Server) => {
    openMenu(e, [
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

  return (
    <div className="flex w-full flex-col items-center gap-2 py-3 bg-rm-bg-floating h-full overflow-y-auto scrollbar-none">
      {/* Home / DM button */}
      <div className="relative flex w-full justify-center group">
        <button
          className={cn(
            "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] bg-rm-bg-elevated text-rm-text-primary transition-all duration-300 hover:rounded-[16px] hover:bg-primary hover:text-primary-foreground",
            activeServerId === "@me" && "rounded-[16px] bg-primary text-primary-foreground shadow-[0_0_20px_var(--rm-glow)]"
          )}
          onClick={() => onSelect("@me")}
        >
          <HomeIcon className="h-7 w-7" />
        </button>
        {/* Indicator pill */}
        <div className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-2 z-50 rounded-r-full bg-rm-text-primary transition-all duration-300",
          activeServerId === "@me" ? "h-10" : "h-0 group-hover:h-5"
        )} />
      </div>

      <div className="mx-auto h-[2px] w-8 rounded-full bg-rm-border" />

      {/* Server icons */}
      {servers.map((server) => {
        const isActive = activeServerId === server.id;
        const hasUnread = !isActive && serverHasUnread(server.id, channels, readStates, lastMessageAt);
        return (
          <div key={server.id} className="relative flex w-full justify-center group">
            <button
              className={cn(
                "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] font-bold transition-all duration-300 hover:rounded-[16px]",
                isActive ? "bg-primary text-primary-foreground shadow-[0_0_20px_var(--rm-glow)]" : "bg-rm-bg-elevated text-rm-text hover:bg-primary hover:text-primary-foreground"
              )}
              onClick={() => onSelect(server.id)}
              onContextMenu={(e) => handleServerContextMenu(e, server)}
            >
              {server.icon_url ? (
                <img
                  src={server.icon_url}
                  alt={server.name}
                  className="h-full w-full rounded-[inherit] object-cover"
                />
              ) : (
                server.name.charAt(0).toUpperCase()
              )}
              {/* Tooltip */}
              <div className="pointer-events-none fixed left-[80px] z-[150] whitespace-nowrap rounded bg-rm-bg-floating px-2 py-1 text-xs font-medium text-rm-text opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-rm-border">
                {server.name}
              </div>
            </button>
            {/* Indicator pill */}
            <div className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2 w-2 z-50 rounded-r-full bg-rm-text-primary transition-all duration-300",
              isActive ? "h-10" : hasUnread ? "h-2" : "h-0 group-hover:h-5"
            )} />
          </div>
        );
      })}

      {/* Add server */}
      <button
        className="group relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[24px] bg-rm-bg-elevated text-rm-text-primary transition-all duration-300 hover:rounded-[16px] hover:bg-primary hover:text-primary-foreground"
        onClick={() => setShowCreate(true)}
      >
        <Plus className="h-6 w-6" />
      </button>

      {showCreate && (
        <CreateServerModal onClose={() => setShowCreate(false)} />
      )}

      {menu.isOpen && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
