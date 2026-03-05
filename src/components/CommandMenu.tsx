
import { useChatActions, useChatState } from "@/stores/chat-store";
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

  const state = useChatState();
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
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

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
      state.channels.filter(
        (c) => c.channel_type === "text" && c.server_id
      ),
    [state.channels]
  );

  const voiceChannels = useMemo(
    () =>
      state.channels.filter(
        (c) => c.channel_type === "voice" && c.server_id
      ),
    [state.channels]
  );

  // Map server IDs to names for display
  const serverMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of state.servers) {
      map.set(s.id, s.name);
    }
    return map;
  }, [state.servers]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        role="presentation"
      />

      {/* Command palette */}
      <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-[540px] px-4">
        <Command
          className="rounded-lg border border-rm-border bg-[var(--rm-bg-surface)] shadow-2xl overflow-hidden"
          shouldFilter={true}
          loop
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-rm-border px-4">
            <Search className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
            <Command.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder="Where would you like to go?"
              className="flex h-12 w-full bg-transparent text-[15px] text-[var(--rm-text-primary)] placeholder:text-[var(--rm-text-muted)] outline-none"
            />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-[var(--rm-text-ghost)] px-1.5 font-mono text-[10px] font-medium text-[var(--rm-text-muted)]">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-[360px] overflow-y-auto p-2 custom-scrollbar">
            <Command.Empty className="py-8 text-center text-sm text-[var(--rm-text-muted)]">
              No results found.
            </Command.Empty>

            <CommandMenuServersGroup servers={state.servers} navigateToServer={navigateToServer} />
            <CommandMenuTextChannelsGroup channels={textChannels} serverMap={serverMap} navigateToChannel={navigateToChannel} />
            <CommandMenuVoiceChannelsGroup channels={voiceChannels} serverMap={serverMap} navigateToChannel={navigateToChannel} />
            <CommandMenuDMsGroup dmChannels={state.dmChannels} navigateToDm={navigateToDm} />
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
            <span className="text-[11px] text-[var(--rm-text-ghost)]">
              Quick Switcher
            </span>
            <div className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border border-[var(--rm-text-ghost)] px-1 font-mono text-[9px] text-[var(--rm-text-ghost)]">
                ↑↓
              </kbd>
              <span className="text-[10px] text-[var(--rm-text-ghost)]">navigate</span>
              <kbd className="ml-2 inline-flex h-4 items-center rounded border border-[var(--rm-text-ghost)] px-1 font-mono text-[9px] text-[var(--rm-text-ghost)]">
                ↵
              </kbd>
              <span className="text-[10px] text-[var(--rm-text-ghost)]">select</span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
