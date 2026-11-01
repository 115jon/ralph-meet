import { create } from "zustand";

import type { Category, Channel, Server, VoiceMember } from "./schema";

export type LoadStatus = "loading" | "ready" | "error";

export interface ServerTree {
  readonly status: LoadStatus;
  readonly categories: readonly Category[];
  readonly channels: readonly Channel[];
}

interface ServersState {
  /** The server list's status; the list itself stays on screen while it reloads. */
  readonly status: LoadStatus;
  readonly servers: readonly Server[];
  readonly selectedId: string | null;
  readonly trees: Readonly<Record<string, ServerTree>>;
  /** channelId → ISO time the user last read it. */
  readonly readAt: Readonly<Record<string, string>>;
  /** channelId → ISO time of its newest message. */
  readonly lastMessageAt: Readonly<Record<string, string>>;
  /** channelId → who is in that voice channel, from the gateway. */
  readonly voice: Readonly<Record<string, readonly VoiceMember[]>>;
}

const INITIAL: ServersState = {
  status: "loading",
  servers: [],
  selectedId: null,
  trees: {},
  readAt: {},
  lastMessageAt: {},
  voice: {},
};

/** State only; the actions that change it live in ./actions. */
export const useServersStore = create<ServersState>()(() => INITIAL);

export function resetServersStore(): void {
  useServersStore.setState(INITIAL, true);
}

const NO_MEMBERS: readonly VoiceMember[] = [];

// ── Selectors: narrow, so a row re-renders only when its own slice changes ──

export function useServerList() {
  const servers = useServersStore((s) => s.servers);
  const status = useServersStore((s) => s.status);
  return { servers, status };
}

export function useSelectedServer(): Server | null {
  return useServersStore(
    (s) => s.servers.find((server) => server.id === s.selectedId) ?? null,
  );
}

export function useServerTree(serverId: string | null): ServerTree | null {
  return useServersStore((s) =>
    serverId ? (s.trees[serverId] ?? null) : null,
  );
}

export function useChannel(channelId: string): Channel | null {
  return useServersStore((s) => {
    for (const tree of Object.values(s.trees)) {
      const channel = tree.channels.find((c) => c.id === channelId);
      if (channel) return channel;
    }
    return null;
  });
}

/** The server that holds `channelId`, if its tree is loaded. */
export function useChannelServer(channelId: string): Server | null {
  return useServersStore((s) => {
    const serverId = Object.keys(s.trees).find((id) =>
      s.trees[id]?.channels.some((c) => c.id === channelId),
    );
    return s.servers.find((server) => server.id === serverId) ?? null;
  });
}

export function isUnread(
  lastMessageAt: string | undefined,
  readAt: string | undefined,
): boolean {
  if (!lastMessageAt) return false;
  return !readAt || lastMessageAt > readAt;
}

export function useIsUnread(channelId: string): boolean {
  return useServersStore((s) =>
    isUnread(s.lastMessageAt[channelId], s.readAt[channelId]),
  );
}

export function useVoiceMembers(channelId: string): readonly VoiceMember[] {
  return useServersStore((s) => s.voice[channelId] ?? NO_MEMBERS);
}
