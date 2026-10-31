import { subscribeChannel } from "@/features/realtime/gateway";
import { markRead } from "@/features/servers/actions";

import { fetchMessages } from "./api";
import type { Message } from "./schema";
import { mergeMessages, useChatStore, type ChannelMessages } from "./store";

const { getState, setState } = useChatStore;

function patchChannel(
  channelId: string,
  patch: (current: ChannelMessages | undefined) => ChannelMessages | undefined,
): void {
  setState((s) => {
    const next = patch(s.channels[channelId]);
    return next ? { channels: { ...s.channels, [channelId]: next } } : s;
  });
}

/**
 * Loads the newest page. It replaces what is cached rather than merging, so
 * a reconnect that missed more than a page never leaves a hole.
 */
export async function loadLatest(channelId: string): Promise<void> {
  patchChannel(channelId, (current) =>
    current?.status === "ready"
      ? current
      : {
          status: "loading",
          messages: [],
          hasMore: false,
          loadingOlder: false,
        },
  );
  try {
    const page = await fetchMessages(channelId);
    patchChannel(channelId, () => ({
      status: "ready",
      messages: mergeMessages([], page.messages),
      hasMore: page.hasMoreBefore ?? false,
      loadingOlder: false,
    }));
  } catch {
    patchChannel(channelId, (current) =>
      current?.status === "ready"
        ? current
        : {
            status: "error",
            messages: [],
            hasMore: false,
            loadingOlder: false,
          },
    );
  }
}

export async function loadOlder(channelId: string): Promise<void> {
  const current = getState().channels[channelId];
  const oldest = current?.messages.at(-1);
  if (!current || !oldest || !current.hasMore || current.loadingOlder) return;
  patchChannel(channelId, (c) => c && { ...c, loadingOlder: true });
  try {
    const page = await fetchMessages(channelId, oldest);
    patchChannel(
      channelId,
      (c) =>
        c && {
          ...c,
          messages: mergeMessages(c.messages, page.messages),
          hasMore: page.hasMoreBefore ?? false,
          loadingOlder: false,
        },
    );
  } catch {
    // Scrolling to the top again retries.
    patchChannel(channelId, (c) => c && { ...c, loadingOlder: false });
  }
}

/** The channel screen came to the front: subscribe, load, mark read. */
export function openChannel(channelId: string): void {
  setState({ openChannelId: channelId });
  subscribeChannel(channelId);
  markRead(channelId);
  void loadLatest(channelId);
}

export function closeChannel(channelId: string): void {
  if (getState().openChannelId !== channelId) return;
  setState({ openChannelId: null });
  subscribeChannel(null);
}

// ── Gateway events ─────────────────────────────────────────────────────────

export function receiveMessage(message: Message): void {
  patchChannel(message.channel_id, (c) =>
    c?.status === "ready"
      ? { ...c, messages: mergeMessages(c.messages, [message]) }
      : c,
  );
}

/** What MESSAGE_UPDATE may change; an absent key is left as it was. */
export interface MessageEdit {
  content?: Message["content"];
  embeds?: Message["embeds"];
}

export function editMessage(id: string, edit: MessageEdit): void {
  setState((s) => {
    for (const [channelId, c] of Object.entries(s.channels)) {
      const index = c.messages.findIndex((message) => message.id === id);
      const message = c.messages[index];
      if (!message) continue;
      const messages = c.messages.slice();
      messages[index] = { ...message, ...edit };
      return { channels: { ...s.channels, [channelId]: { ...c, messages } } };
    }
    return s;
  });
}

export function deleteMessage(id: string): void {
  setState((s) => {
    for (const [channelId, c] of Object.entries(s.channels)) {
      if (!c.messages.some((message) => message.id === id)) continue;
      const messages = c.messages.filter((message) => message.id !== id);
      return { channels: { ...s.channels, [channelId]: { ...c, messages } } };
    }
    return s;
  });
}
