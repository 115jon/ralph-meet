"use client";

import { useChatActions, useChatState } from "@/lib/chat-context";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Command } from "cmdk";
import {
  Hash,
  MessageSquare,
  Mic,
  MicOff,
  Moon,
  Search,
  Server,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const settings = useVoiceSettingsStore((s) => s.getSettings());
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
    if (open) {
      setSearch("");
      // cmdk auto-focuses, but let's be safe
      requestAnimationFrame(() => inputRef.current?.focus());
    }
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

            {/* ── Servers ────── */}
            {state.servers.length > 0 && (
              <Command.Group
                heading="Servers"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
              >
                {state.servers.map((server) => (
                  <Command.Item
                    key={server.id}
                    value={`server ${server.name}`}
                    onSelect={() => navigateToServer(server.id)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--rm-bg-elevated)] text-[10px] font-bold overflow-hidden">
                      {server.icon_url ? (
                        <img
                          src={server.icon_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        server.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span>{server.name}</span>
                    <Server className="ml-auto h-3.5 w-3.5 text-[var(--rm-text-ghost)]" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* ── Text Channels ─── */}
            {textChannels.length > 0 && (
              <Command.Group
                heading="Text Channels"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
              >
                {textChannels.map((channel) => (
                  <Command.Item
                    key={channel.id}
                    value={`channel ${channel.name} ${serverMap.get(channel.server_id!) ?? ""}`}
                    onSelect={() =>
                      navigateToChannel(channel.server_id!, channel.id)
                    }
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
            )}

            {/* ── Voice Channels ─── */}
            {voiceChannels.length > 0 && (
              <Command.Group
                heading="Voice Channels"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
              >
                {voiceChannels.map((channel) => (
                  <Command.Item
                    key={channel.id}
                    value={`voice ${channel.name} ${serverMap.get(channel.server_id!) ?? ""}`}
                    onSelect={() =>
                      navigateToChannel(channel.server_id!, channel.id)
                    }
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
            )}

            {/* ── DMs ────── */}
            {state.dmChannels.length > 0 && (
              <Command.Group
                heading="Direct Messages"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--rm-text-muted)]"
              >
                {state.dmChannels.map((dm) => (
                  <Command.Item
                    key={dm.id}
                    value={`dm ${dm.recipient?.username ?? dm.name}`}
                    onSelect={() => navigateToDm(dm.id)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--rm-text-secondary)] aria-selected:bg-[var(--rm-bg-hover)] aria-selected:text-[var(--rm-text-primary)] transition-colors"
                  >
                    <div className="h-5 w-5 rounded-full bg-[var(--rm-bg-elevated)] overflow-hidden flex items-center justify-center shrink-0">
                      {dm.recipient?.avatar_url ? (
                        <img
                          src={dm.recipient.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <MessageSquare className="h-3 w-3 text-[var(--rm-text-muted)]" />
                      )}
                    </div>
                    <span>
                      {dm.recipient?.username ?? dm.name}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* ── Quick Actions ────── */}
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
                <span>
                  Switch to {theme === "dark" ? "Light" : "Dark"} Mode
                </span>
              </Command.Item>
            </Command.Group>
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
