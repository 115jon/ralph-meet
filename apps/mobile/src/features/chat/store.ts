import { create } from "zustand";

import type { LoadStatus } from "@/features/servers/store";

import type { Message } from "./schema";

export interface ChannelMessages {
  readonly status: LoadStatus;
  /** Newest first, the order the inverted list draws. */
  readonly messages: readonly Message[];
  /** Older messages remain on the server. */
  readonly hasMore: boolean;
  readonly loadingOlder: boolean;
}

interface ChatState {
  readonly channels: Readonly<Record<string, ChannelMessages>>;
  /** The channel on screen; its new messages are marked read. */
  readonly openChannelId: string | null;
}

const INITIAL: ChatState = { channels: {}, openChannelId: null };

/** State only; the actions that change it live in ./actions. */
export const useChatStore = create<ChatState>()(() => INITIAL);

export function resetChatStore(): void {
  useChatStore.setState(INITIAL, true);
}

export function useChannelMessages(channelId: string): ChannelMessages | null {
  return useChatStore((s) => s.channels[channelId] ?? null);
}

function compareNewestFirst(a: Message, b: Message): number {
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** `current` plus `incoming`, one copy per id (incoming wins), newest first. */
export function mergeMessages(
  current: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareNewestFirst);
}
