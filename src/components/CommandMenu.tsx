import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Command } from "cmdk";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { MENU_PANEL } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { Server } from "@/lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { openMessageSearch } from "./chat/search/open-message-search";
import { useAppearanceTheme } from "./chat/useAppearanceTheme";
import { commandFilter, parseCommandSearch } from "./command-menu-filter";
import {
  COMMAND_KBD,
  CommandMenuActionsGroup,
  CommandMenuChannelsGroup,
  CommandMenuDMsGroup,
  CommandMenuSearchItem,
  CommandMenuServersGroup,
} from "./CommandMenuGroups";

const PREFIX_HINTS: Array<[string, string]> = [
  ["@", "people"],
  ["#", "channels"],
  ["!", "voice"],
  ["*", "servers"],
];

/**
 * Discord-style quick switcher, Ctrl+K / Cmd+K. Servers, channels and DMs
 * with their icons and avatars; `@ # ! *` narrow to one kind; typed text can
 * be handed to message search. No open animation: it is a keyboard surface
 * used many times a day.
 */
export default function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const channels = useChatStore((s) => s.channels);
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

  // ── Open / close ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch("");
        setOpen((prev) => !prev);
      }
    };
    const openHandler = () => {
      setSearch("");
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

  const { kind, query } = parseCommandSearch(search);
  const inDm = activeServerId === "@me";
  const searchScopeLabel = inDm
    ? (dmChannels.find((dm) => dm.id === activeChannelId)?.recipient
        ?.display_name ?? "this conversation")
    : (serverMap.get(activeServerId ?? "")?.name ?? "this server");
  const canSearchMessages =
    !kind && query.length >= 2 && !!activeChannelId && !!activeServerId;

  // The Dialog owns Escape, the scrim, the back button, the focus trap and
  // focus return. Keyboard-initiated, so neither the scrim nor the panel
  // animates (design-system 9.6).
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
            className={cn(MENU_PANEL, "overflow-hidden p-0 shadow-2xl")}
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
            <div className="flex items-center gap-2.5 border-b border-rm-border px-3.5">
              <Icon
                name="search"
                size="md"
                className="shrink-0 text-rm-text-muted"
              />
              <Command.Input
                ref={inputRef}
                value={search}
                onValueChange={setSearch}
                placeholder="Where would you like to go?"
                className="rm-search-input h-12 w-full bg-transparent text-ui-base text-rm-text outline-none placeholder:text-rm-text-muted max-md:h-14 max-md:text-ui-md"
              />
              <kbd
                className={cn(
                  COMMAND_KBD,
                  "hidden shrink-0 pointer-fine:inline-flex",
                )}
              >
                Esc
              </kbd>
            </div>

            <Command.List className="max-h-[min(420px,calc(100dvh-160px))] overflow-y-auto overscroll-contain p-1.5 custom-scrollbar">
              <Command.Empty className="px-4 py-10 text-center">
                <p className="text-ui-sm font-medium text-rm-text">
                  Nothing matches “{query}”
                </p>
                <p className="mt-1 text-ui-xs text-rm-text-muted">
                  Start with @ for people, # for channels or * for servers.
                </p>
              </Command.Empty>

              <CommandMenuDMsGroup
                dmChannels={dmChannels}
                navigateToDm={navigateToDm}
              />
              <CommandMenuChannelsGroup
                heading="Text channels"
                kind="channel"
                channels={textChannels}
                serverMap={serverMap}
                navigateToChannel={navigateToChannel}
              />
              <CommandMenuChannelsGroup
                heading="Voice channels"
                kind="voice"
                channels={voiceChannels}
                serverMap={serverMap}
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

            <div className="hidden items-center justify-between gap-4 border-t border-rm-border px-3.5 py-2 text-ui-2xs text-rm-text-muted pointer-fine:flex">
              <div className="flex items-center gap-2.5">
                {PREFIX_HINTS.map(([prefix, label]) => (
                  <span key={prefix} className="inline-flex items-center gap-1">
                    <kbd className={COMMAND_KBD}>{prefix}</kbd>
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1">
                  <kbd className={COMMAND_KBD}>↑</kbd>
                  <kbd className={COMMAND_KBD}>↓</kbd>
                  move
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className={COMMAND_KBD}>↵</kbd>
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
