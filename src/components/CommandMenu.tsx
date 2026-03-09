
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import {
  CommandMenuActionsGroup,
  CommandMenuDMsGroup,
  CommandMenuServersGroup,
  CommandMenuTextChannelsGroup,
  CommandMenuVoiceChannelsGroup,
} from "./CommandMenuGroups";

/**
 * Discord-style Quick Switcher — opens with Ctrl+K / Cmd+K.
 * Fuzzy-searches servers, channels, and DMs; provides quick-action commands.
 */
export default function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const channels = useChatStore(s => s.channels);
  const servers = useChatStore(s => s.servers);
  const dmChannels = useChatStore(s => s.dmChannels);
  const { dispatch } = useChatActions();
  const { theme, setTheme } = useTheme();

  // Voice settings for mute/deafen toggles
  const setIsMuted = useVoiceSettingsStore((s) => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore((s) => s.setIsDeafened);
  const settings = useVoiceSettingsStore(useShallow((s) => s.getSettings()));
  const isMuted = settings.isMuted;
  const isDeafened = settings.isDeafened;

  // ── Keyboard shortcut ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const openHandler = () => setOpen(true);
    document.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("open-command-menu", openHandler);
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("open-command-menu", openHandler);
    };
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    let t: NodeJS.Timeout;
    if (open) {
      t = setTimeout(() => setSearch(""), 0);
      // cmdk auto-focuses, but let's be safe
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    return () => clearTimeout(t);
  }, [open]);

  // ── Navigation helpers ─────────────────────────────────────────────────

  const navigateToServer = useCallback(
    (serverId: string) => {
      dispatch({ type: "SWITCH_SERVER", serverId, channelId: null });
      // Update URL silently
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/chat/${serverId}`);
      }
      setOpen(false);
    },
    [dispatch]
  );

  const navigateToChannel = useCallback(
    (serverId: string, channelId: string) => {
      dispatch({ type: "SWITCH_SERVER", serverId, channelId });
      if (typeof window !== "undefined") {
        window.history.replaceState(
          null,
          "",
          `/chat/${serverId}/${channelId}`
        );
      }
      setOpen(false);
    },
    [dispatch]
  );

  const navigateToDm = useCallback(
    (channelId: string) => {
      dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId });
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/chat/@me/${channelId}`);
      }
      setOpen(false);
    },
    [dispatch]
  );

  // ── Computed data ──────────────────────────────────────────────────────

  const textChannels = useMemo(
    () =>
      channels.filter(
        (c: any) => c.channel_type === "text" && c.server_id
      ),
    [channels]
  );

  const voiceChannels = useMemo(
    () =>
      channels.filter(
        (c: any) => c.channel_type === "voice" && c.server_id
      ),
    [channels]
  );

  // Map server IDs to names for display
  const serverMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of servers) {
      map.set(s.id, s.name);
    }
    return map;
  }, [servers]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-200">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        role="presentation"
      />

      {/* Command palette */}
      <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-[540px] px-4">
        <Command
          className="rounded-lg border border-rm-border bg-rm-bg-surface shadow-2xl overflow-hidden"
          shouldFilter={true}
          loop
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              // Make Tab and Shift+Tab act like ArrowDown and ArrowUp
              const event = new KeyboardEvent("keydown", {
                key: e.shiftKey ? "ArrowUp" : "ArrowDown",
                code: e.shiftKey ? "ArrowUp" : "ArrowDown",
                bubbles: true,
                cancelable: true,
              });
              e.target.dispatchEvent(event);
            }
          }}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-rm-border px-4">
            <Search className="h-4 w-4 shrink-0 text-rm-text-muted" />
            <Command.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder="Where would you like to go?"
              className="flex h-12 w-full bg-transparent text-[15px] text-rm-text placeholder:text-rm-text-muted outline-none"
            />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-rm-text-ghost px-1.5 font-mono text-[10px] font-medium text-rm-text-muted">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-[360px] overflow-y-auto p-2 custom-scrollbar">
            <Command.Empty className="py-8 text-center text-sm text-rm-text-muted">
              No results found.
            </Command.Empty>

            <CommandMenuServersGroup servers={servers} navigateToServer={navigateToServer} />
            <CommandMenuTextChannelsGroup channels={textChannels} serverMap={serverMap} navigateToChannel={navigateToChannel} />
            <CommandMenuVoiceChannelsGroup channels={voiceChannels} serverMap={serverMap} navigateToChannel={navigateToChannel} />
            <CommandMenuDMsGroup dmChannels={dmChannels} navigateToDm={navigateToDm} />
            <CommandMenuActionsGroup
              isMuted={isMuted}
              setIsMuted={setIsMuted}
              isDeafened={isDeafened}
              setIsDeafened={setIsDeafened}
              theme={theme}
              setTheme={setTheme}
              setOpen={setOpen}
            />
          </Command.List>

          {/* Footer hint */}
          <div className="flex items-center justify-between border-t border-rm-border px-4 py-2">
            <span className="text-[11px] text-rm-text-ghost">
              Quick Switcher
            </span>
            <div className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border border-rm-text-ghost px-1 font-mono text-[9px] text-rm-text-ghost">
                ↑↓
              </kbd>
              <span className="text-[10px] text-rm-text-ghost">navigate</span>
              <kbd className="ml-2 inline-flex h-4 items-center rounded border border-rm-text-ghost px-1 font-mono text-[9px] text-rm-text-ghost">
                ↵
              </kbd>
              <span className="text-[10px] text-rm-text-ghost">select</span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
