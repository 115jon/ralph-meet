import { create } from "zustand";

import type { Message } from "@/features/chat/schema";
import {
  isUnread,
  useServersStore,
  type LoadStatus,
} from "@/features/servers/store";

import type { DmChannel } from "./schema";

interface DmsState {
  readonly status: LoadStatus;
  readonly dms: readonly DmChannel[];
  /** channelId → its newest message; null when it has none. */
  readonly previews: Readonly<Record<string, Message | null>>;
}

const INITIAL: DmsState = { status: "loading", dms: [], previews: {} };

/** State only; the actions that change it live in ./actions. */
export const useDmsStore = create<DmsState>()(() => INITIAL);

export function resetDmsStore(): void {
  useDmsStore.setState(INITIAL, true);
}

export function useDm(channelId: string): DmChannel | null {
  return useDmsStore((s) => s.dms.find((dm) => dm.id === channelId) ?? null);
}

export function useDmPreview(channelId: string): Message | null {
  return useDmsStore((s) => s.previews[channelId] ?? null);
}

/** Conversations with a message the user has not read: the DMs key's count. */
export function useUnreadDmCount(): number {
  const dms = useDmsStore((s) => s.dms);
  return useServersStore(
    (s) =>
      dms.filter((dm) => isUnread(s.lastMessageAt[dm.id], s.readAt[dm.id]))
        .length,
  );
}

/** The list, most recent conversation first. */
export function sortByActivity(
  dms: readonly DmChannel[],
  lastMessageAt: Readonly<Record<string, string>>,
): DmChannel[] {
  const at = (dm: DmChannel) => lastMessageAt[dm.id] ?? dm.created_at;
  return [...dms].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));
}
