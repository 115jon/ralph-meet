import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Command } from "cmdk";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { MENU_PANEL } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { Server } from "@/lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { openMessageSearch } from "./chat/search/open-message-search";
import { useAppearanceTheme } from "./chat/useAppearanceTheme";
import {
  commandFilter,
  loadRecentTargets,
  parseCommandSearch,
  RECENT_SHOWN,
  recordRecentTarget,
  type RecentTarget,
} from "./command-menu-filter";
import {
  CommandMenuActionsGroup,
  CommandMenuChannelsGroup,
  CommandMenuDMsGroup,
  CommandMenuPlacesGroup,
  CommandMenuSearchItem,
  CommandMenuServersGroup,
  type CommandPlace,
} from "./CommandMenuGroups";

const PREFIX_HINTS: Array<[string, string]> = [
  ["@", "people"],
  ["#", "channels"],
  ["!", "voice"],
  ["*", "servers"],
];

/** Read state captured when the menu opens; it doesn't need to stay live. */
type OpenSnapshot = {
  recent: RecentTarget[];
  readStates: Record<string, string>;
  lastMessageAt: Record<string, string>;
  mentions: Record<string, number>;
};

const EMPTY_SNAPSHOT: OpenSnapshot = {
  recent: [],
  readStates: {},
  lastMessageAt: {},
  mentions: {},
};

function takeSnapshot(): OpenSnapshot {
  const s = useChatStore.getState();
  return {
    recent: loadRecentTargets(),
    readStates: s.readStates,
    lastMessageAt: s.lastMessageAt,
    mentions: s.channelMentionCounts,
  };
}

function isUnread(id: string, snap: OpenSnapshot): boolean {
  const last = snap.lastMessageAt[id];
  if (!last) return false;
  const read = snap.readStates[id];
  return !read || last > read;
}

/**
 * Discord-style quick switcher, Ctrl+K / Cmd+K. Servers, channels and DMs
 * with their icons and avatars; `@ # ! *` narrow to one kind; typed text can
 * be handed to message search. Idle, it leads with Recent and Unread. No open
 * animation: it is a keyboard surface used many times a day.
 */
export default function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [snapshot, setSnapshot] = useState<OpenSnapshot>(EMPTY_SNAPSHOT);
  const inputRef = useRef<HTMLInputElement>(null);

  const channels = useChatStore((s) => s.channels);
  const channelsByServerId = useChatStore((s) => s.channelsByServerId);
  const servers = useChatStore((s) => s.servers);
  const dmChannels = useChatStore((s) => s.dmChannels);
  const activeServerId = useChatStore((s) => s.activeServerId);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const { dispatch } = useChatActions();
  const { theme, setAppearanceTheme } = useAppearanceTheme();

  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const settings = useVoiceSettingsStore(useShallow((s) => s.getSettings()));
  const isMuted = settings.isMuted;
  const isDeafened = settings.isDeafened;

  // ── Recent places ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeServerId || !activeChannelId) return;
    recordRecentTarget({
      serverId: activeServerId,
      channelId: activeChannelId,
    });
  }, [activeServerId, activeChannelId]);

  // ── Open / close ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch("");
        setSnapshot(takeSnapshot());
        setOpen((prev) => !prev);
      }
    };
    const openHandler = () => {
      setSearch("");
      setSnapshot(takeSnapshot());
      setOpen(true);
    };
    document.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("open-command-menu", openHandler);
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("open-command-menu", openHandler);
    };
  }, []);

  // ── Navigation ─────────────────────────────────────────────────────────

  const navigateToServer = useCallback(
    (serverId: string) => {
      dispatch({ type: "SWITCH_SERVER", serverId, channelId: null });
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/chat/${serverId}`);
      }
      setOpen(false);
    },
    [dispatch],
  );

  const navigateToChannel = useCallback(
    (serverId: string, channelId: string) => {
      dispatch({ type: "SWITCH_SERVER", serverId, channelId });
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/chat/${serverId}/${channelId}`);
      }
      setOpen(false);
    },
    [dispatch],
  );

  const navigateToDm = useCallback(
    (channelId: string) => {
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/chat/@me/${channelId}`);
      }
      setOpen(false);
    },
    [dispatch],
  );

  // ── Data ───────────────────────────────────────────────────────────────

  const textChannels = useMemo(
    () => channels.filter((c) => c.channel_type === "text" && c.server_id),
    [channels],
  );
  const voiceChannels = useMemo(
    () => channels.filter((c) => c.channel_type === "voice" && c.server_id),
    [channels],
  );
  const serverMap = useMemo(() => {
    const map = new Map<string, Server>();
    for (const s of servers) map.set(s.id, s);
    return map;
  }, [servers]);
  // In one server the server name on every row is noise.
  const showServer = servers.length > 1;

  const findChannel = useCallback(
    (serverId: string, channelId: string) =>
      (channelsByServerId[serverId] ?? channels).find(
        (c) => c.id === channelId,
      ),
    [channels, channelsByServerId],
  );

  const toPlace = useCallback(
    (serverId: string, channelId: string, badge = 0): CommandPlace | null => {
      if (serverId === "@me") {
        const dm = dmChannels.find((d) => d.id === channelId);
        return dm ? { kind: "dm", dm, badge } : null;
      }
      const channel = findChannel(serverId, channelId);
      if (
        !channel?.server_id ||
        (channel.channel_type !== "text" && channel.channel_type !== "voice")
      )
        return null;
      return {
        kind: channel.channel_type === "voice" ? "voice" : "channel",
        channel,
        server: showServer ? serverMap.get(channel.server_id) : undefined,
        badge,
      };
    },
    [dmChannels, findChannel, serverMap, showServer],
  );

  const recentPlaces = useMemo(() => {
    if (!open) return [];
    return snapshot.recent
      .filter((t) => t.channelId !== activeChannelId)
      .map((t) => toPlace(t.serverId, t.channelId))
      .filter((p): p is CommandPlace => p !== null)
      .slice(0, RECENT_SHOWN);
  }, [open, snapshot, activeChannelId, toPlace]);

  const unreadPlaces = useMemo(() => {
    if (!open) return [];
    const ids = [
      ...dmChannels.map((d) => ["@me", d.id] as const),
      ...textChannels.map((c) => [c.server_id!, c.id] as const),
    ].filter(([, id]) => id !== activeChannelId && isUnread(id, snapshot));
    // Mentions first, then the most recent activity.
    ids.sort(([, a], [, b]) => {
      const m = (snapshot.mentions[b] ?? 0) - (snapshot.mentions[a] ?? 0);
      if (m !== 0) return m;
      return (snapshot.lastMessageAt[b] ?? "").localeCompare(
        snapshot.lastMessageAt[a] ?? "",
      );
    });
    return ids
      .slice(0, RECENT_SHOWN)
      .map(([serverId, id]) => toPlace(serverId, id, snapshot.mentions[id]))
      .filter((p): p is CommandPlace => p !== null);
  }, [open, snapshot, dmChannels, textChannels, activeChannelId, toPlace]);

  const { kind, query } = parseCommandSearch(search);
  const idle = search.trim() === "";
  const inDm = activeServerId === "@me";
  const searchScopeLabel = inDm
    ? (dmChannels.find((dm) => dm.id === activeChannelId)?.recipient
        ?.display_name ?? "this conversation")
    : (serverMap.get(activeServerId ?? "")?.name ?? "this server");
  const canSearchMessages =
    !kind && query.length >= 2 && !!activeChannelId && !!activeServerId;

  // The Dialog owns Escape, the scrim, the back button, the focus trap and
  // focus return. Keyboard-initiated, so neither the scrim nor the panel
  // animates (spec §6).
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogOverlay className="data-[state=closed]:animate-none! data-[state=open]:animate-none!" />
        <DialogSurface
          showCloseButton={false}
          aria-label="Quick switcher"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed inset-x-0 top-[max(12dvh,calc(var(--safe-area-top,0px)+8px))] z-50 mx-auto w-full max-w-[560px] px-3 outline-none max-md:top-[calc(var(--safe-area-top,0px)+8px)] max-md:px-2"
        >
          <Command
            label="Quick switcher"
            className={cn(MENU_PANEL, "overflow-hidden p-0 shadow-modal")}
            filter={commandFilter}
            loop
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                // Tab and Shift+Tab move through results like the arrows.
                e.preventDefault();
                e.target.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: e.shiftKey ? "ArrowUp" : "ArrowDown",
                    code: e.shiftKey ? "ArrowUp" : "ArrowDown",
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              }
            }}
          >
            {/* The input is borderless, so the row's bottom edge carries the
                field focus: an inset 2px line that never shifts the layout. */}
            <div className="flex h-12 items-center gap-2 px-3 shadow-[inset_0_-1px_0_var(--line)] has-[input:focus-visible]:shadow-[inset_0_-2px_0_var(--focus)] max-md:h-14">
              <Icon name="search" size="sm" className="shrink-0 text-ink-3" />
              <Command.Input
                ref={inputRef}
                value={search}
                onValueChange={setSearch}
                placeholder="Jump to a channel, person or server"
                className="rm-search-input h-full w-full min-w-0 bg-transparent text-ui-row text-ink-1 outline-none placeholder:text-ink-3 max-md:text-ui-md"
              />
              <Kbd className="hidden shrink-0 pointer-fine:inline-flex">
                Esc
              </Kbd>
            </div>

            <Command.List className="max-h-[min(420px,calc(100dvh-160px))] scroll-py-1 overflow-y-auto overscroll-contain p-1 custom-scrollbar">
              <Command.Empty>
                <EmptyState
                  size="sm"
                  art={null}
                  title={`Nothing matches “${query}”`}
                  description="Start with @ for people, # for channels or * for servers."
                />
              </Command.Empty>

              {idle && (
                <>
                  <CommandMenuPlacesGroup
                    heading="Recent"
                    tag="recent"
                    places={recentPlaces}
                    navigateToDm={navigateToDm}
                    navigateToChannel={navigateToChannel}
                  />
                  <CommandMenuPlacesGroup
                    heading="Unread"
                    tag="unread"
                    places={unreadPlaces}
                    navigateToDm={navigateToDm}
                    navigateToChannel={navigateToChannel}
                  />
                </>
              )}
              <CommandMenuDMsGroup
                dmChannels={dmChannels}
                navigateToDm={navigateToDm}
              />
              <CommandMenuChannelsGroup
                heading="Text channels"
                kind="channel"
                channels={textChannels}
                serverMap={serverMap}
                showServer={showServer}
                navigateToChannel={navigateToChannel}
              />
              <CommandMenuChannelsGroup
                heading="Voice channels"
                kind="voice"
                channels={voiceChannels}
                serverMap={serverMap}
                showServer={showServer}
                navigateToChannel={navigateToChannel}
              />
              <CommandMenuServersGroup
                servers={servers}
                activeServerId={activeServerId}
                navigateToServer={navigateToServer}
              />
              <CommandMenuActionsGroup
                isMuted={isMuted}
                setIsMuted={setIsMuted}
                isDeafened={isDeafened}
                setIsDeafened={setIsDeafened}
                theme={theme}
                setTheme={setAppearanceTheme}
                setOpen={setOpen}
              />
              {canSearchMessages && (
                <CommandMenuSearchItem
                  query={query}
                  scopeLabel={searchScopeLabel}
                  onSelect={() => {
                    setOpen(false);
                    openMessageSearch(query);
                  }}
                />
              )}
            </Command.List>

            <div className="hidden items-center justify-between gap-4 border-t border-line px-3 py-2 text-ui-xs text-ink-3 pointer-fine:flex">
              <div className="flex items-center gap-3">
                {PREFIX_HINTS.map(([prefix, label]) => (
                  <span
                    key={prefix}
                    className="inline-flex items-center gap-1.5"
                  >
                    <Kbd>{prefix}</Kbd>
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <KbdGroup>
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                  </KbdGroup>
                  move
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↵</Kbd>
                  open
                </span>
              </div>
            </div>
          </Command>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
