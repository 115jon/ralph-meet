import { create } from "zustand";

import type { LoadStatus } from "@/features/servers/store";

import type { Message } from "./schema";

/** An optimistic row's state until the server's copy replaces it. */
export type SendState = "sending" | "failed";

export type ChatMessage = Message & { readonly send?: SendState };

export interface ChannelMessages {
  readonly status: LoadStatus;
  /** Newest first, the order the inverted list draws. */
  readonly messages: readonly ChatMessage[];
  /** Older messages remain on the server. */
  readonly hasMore: boolean;
  readonly loadingOlder: boolean;
}

/** channelId → its cached history. */
export type ChannelCache = Readonly<Record<string, ChannelMessages>>;

interface ChatState {
  readonly channels: ChannelCache;
  /** The channel on screen; its new messages are marked read. */
  readonly openChannelId: string | null;
  /** channelId → ids of the people typing there now. */
  readonly typing: Readonly<Record<string, readonly string[]>>;
}

const INITIAL: ChatState = {
  channels: {},
  openChannelId: null,
  typing: {},
};

/** State only; the actions that change it live in ./actions and ./mutations. */
export const useChatStore = create<ChatState>()(() => INITIAL);

export function resetChatStore(): void {
  useChatStore.setState(INITIAL, true);
}

const NOBODY: readonly string[] = [];

export function useChannelMessages(channelId: string): ChannelMessages | null {
  return useChatStore((s) => s.channels[channelId] ?? null);
}

export function useTypingIds(channelId: string): readonly string[] {
  return useChatStore((s) => s.typing[channelId] ?? NOBODY);
}

/** The optimistic row's id for a send, so the echo can find and replace it. */
export function pendingId(nonce: string): string {
  return `pending-${nonce}`;
}

function compareNewestFirst(a: Message, b: Message): number {
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * `current` plus `incoming`, one copy per id (incoming wins), newest first.
 * A server message carrying a nonce replaces the optimistic row it confirms,
 * as the web reducer's APPEND_MESSAGE does.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (message.nonce && !message.send) byId.delete(pendingId(message.nonce));
    byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareNewestFirst);
}
