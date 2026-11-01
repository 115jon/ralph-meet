import { subscribeServers } from "@/features/realtime/gateway";

import {
  fetchReadStates,
  fetchServerChannels,
  fetchServers,
  markChannelRead,
} from "./api";
import { readLastServer, writeLastServer } from "./last-server";
import type { VoiceMember } from "./schema";
import { useServersStore, type ServerTree } from "./store";

const { getState, setState } = useServersStore;

function setTree(serverId: string, tree: ServerTree): void {
  setState((s) => ({ trees: { ...s.trees, [serverId]: tree } }));
}

/**
 * Loads a server's channels. A tree already on screen stays there while it
 * reloads; only a first load shows the loading state.
 */
export async function loadTree(serverId: string): Promise<void> {
  const current = getState().trees[serverId];
  if (!current || current.status === "error") {
    setTree(serverId, { status: "loading", categories: [], channels: [] });
  }
  try {
    const { categories, channels } = await fetchServerChannels(serverId);
    setTree(serverId, { status: "ready", categories, channels });
  } catch {
    if (current?.status === "ready") return;
    setTree(serverId, { status: "error", categories: [], channels: [] });
  }
}

export async function refreshReadStates(): Promise<void> {
  try {
    const { read_states, last_messages } = await fetchReadStates();
    const readAt: Record<string, string> = {};
    for (const row of read_states) readAt[row.channel_id] = row.last_read_at;
    const lastMessageAt: Record<string, string> = {};
    for (const row of last_messages) {
      if (row.last_message_at) {
        lastMessageAt[row.channel_id] = row.last_message_at;
      }
    }
    setState({ readAt, lastMessageAt });
  } catch {
    // Unread marks are a nicety; the tree works without them.
  }
}

/** Loads the server list, restores the last server and loads every tree, that one first. */
export async function loadServers(): Promise<void> {
  if (getState().servers.length === 0) setState({ status: "loading" });
  try {
    const [servers, stored] = await Promise.all([
      fetchServers(),
      readLastServer(),
    ]);
    const previous = getState().selectedId ?? stored;
    const selectedId =
      servers.find((server) => server.id === previous)?.id ??
      servers[0]?.id ??
      null;
    setState({ status: "ready", servers, selectedId });
    subscribeServers(servers.map((server) => server.id));
    if (selectedId) void loadTree(selectedId);
    // The rest load behind it, so every rail tile can show its unread pill.
    for (const server of servers) {
      if (server.id !== selectedId && !getState().trees[server.id]) {
        void loadTree(server.id);
      }
    }
    void refreshReadStates();
  } catch {
    setState({ status: "error" });
  }
}

export function selectServer(serverId: string): void {
  if (getState().selectedId === serverId) return;
  setState({ selectedId: serverId });
  writeLastServer(serverId);
  if (getState().trees[serverId]?.status !== "ready") void loadTree(serverId);
}

/** Marks a channel read now, on screen at once and on the server after. */
export function markRead(channelId: string): void {
  const s = getState();
  const readAt = s.lastMessageAt[channelId] ?? new Date().toISOString();
  setState({ readAt: { ...s.readAt, [channelId]: readAt } });
  markChannelRead(channelId).catch(() => undefined);
}

// ── Gateway events ─────────────────────────────────────────────────────────

export function setVoiceStates(
  voice: Readonly<Record<string, readonly VoiceMember[]>>,
): void {
  setState({ voice });
}

export function setVoiceChannel(
  channelId: string,
  members: readonly VoiceMember[],
): void {
  setState((s) => ({ voice: { ...s.voice, [channelId]: members } }));
}

export function noteMessage(channelId: string, createdAt: string): void {
  setState((s) => {
    const last = s.lastMessageAt[channelId];
    if (last && last >= createdAt) return s;
    return { lastMessageAt: { ...s.lastMessageAt, [channelId]: createdAt } };
  });
}

export function noteRead(channelId: string, readAt: string): void {
  setState((s) => ({ readAt: { ...s.readAt, [channelId]: readAt } }));
}
