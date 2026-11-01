import { markChannelRead as readChannelActivity } from "@/features/activity/actions";
import { subscribeChannel } from "@/features/realtime/gateway";
import { markRead } from "@/features/servers/actions";

import { ApiError } from "@/lib/api";

import { fetchMessages } from "./api";
import { evictChannels, trimChannel } from "./cache";
import type { Message, Reaction } from "./schema";
import {
  mergeMessages,
  pendingId,
  useChatStore,
  type ChannelMessages,
  type ChatMessage,
} from "./store";

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

/** Applies `patch` to the message with `id`, wherever it is cached. */
function patchMessage(
  id: string,
  patch: (message: ChatMessage) => ChatMessage,
): void {
  setState((s) => {
    for (const [channelId, c] of Object.entries(s.channels)) {
      const index = c.messages.findIndex((message) => message.id === id);
      const message = c.messages[index];
      if (!message) continue;
      const messages = c.messages.slice();
      messages[index] = patch(message);
      return { channels: { ...s.channels, [channelId]: { ...c, messages } } };
    }
    return s;
  });
}

/** Optimistic rows still waiting or failed: kept across a reload. */
function localRows(current: ChannelMessages | undefined): ChatMessage[] {
  return current?.messages.filter((message) => message.send) ?? [];
}

// channelId → how many times a jump replaced its cache. A page that was
// asked for before a jump must not land on top of the jump's.
const epochs = new Map<string, number>();
const epochOf = (channelId: string) => epochs.get(channelId) ?? 0;

/**
 * Loads the newest page. It replaces what is cached rather than merging, so
 * a reconnect that missed more than a page never leaves a hole; only the
 * user's unsent rows carry over.
 */
export async function loadLatest(channelId: string): Promise<void> {
  const epoch = epochOf(channelId);
  patchChannel(channelId, (current) =>
    current?.status === "ready"
      ? current
      : {
          status: "loading",
          messages: localRows(current),
          hasMore: false,
          loadingOlder: false,
        },
  );
  try {
    const page = await fetchMessages(channelId);
    if (epochOf(channelId) !== epoch) return;
    patchChannel(channelId, (current) => ({
      status: "ready",
      messages: mergeMessages(localRows(current), page.messages),
      hasMore: page.hasMoreBefore ?? false,
      loadingOlder: false,
    }));
  } catch {
    if (epochOf(channelId) !== epoch) return;
    patchChannel(channelId, (current) =>
      current?.status === "ready"
        ? current
        : {
            status: "error",
            messages: localRows(current),
            hasMore: false,
            loadingOlder: false,
          },
    );
  }
}

export async function loadOlder(channelId: string): Promise<void> {
  const current = getState().channels[channelId];
  const oldest = current?.messages.findLast((message) => !message.send);
  if (!current || !oldest || !current.hasMore || current.loadingOlder) return;
  patchChannel(channelId, (c) => c && { ...c, loadingOlder: true });
  try {
    const page = await fetchMessages(channelId, { before: oldest });
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

/**
 * Loads the page around `messageId` in place of the cache (which then has
 * newer messages to page back in), voiding any older load still in flight.
 * Answers whether the message is loaded now; false when it is gone.
 */
export async function loadAround(
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const has = () =>
    getState().channels[channelId]?.messages.some((m) => m.id === messageId) ??
    false;
  const epoch = epochOf(channelId) + 1;
  epochs.set(channelId, epoch);
  patchChannel(channelId, (current) => ({
    status: "loading",
    messages: localRows(current),
    hasMore: false,
    loadingOlder: false,
  }));
  try {
    const page = await fetchMessages(channelId, { around: messageId });
    if (epochOf(channelId) !== epoch) return has();
    patchChannel(channelId, (current) => ({
      status: "ready",
      messages: mergeMessages(localRows(current), page.messages),
      hasMore: page.hasMoreBefore ?? false,
      loadingOlder: false,
      hasNewer: page.hasMoreAfter ?? false,
    }));
    return has();
  } catch (error) {
    if (epochOf(channelId) !== epoch) return has();
    // Deleted, or never there: back to the present.
    if (error instanceof ApiError && error.status === 404) {
      epochs.set(channelId, epoch + 1);
    }
    await loadLatest(channelId);
    return false;
  }
}

/** Pages newer messages back in after a jump, until the present. */
export async function loadNewer(channelId: string): Promise<void> {
  const current = getState().channels[channelId];
  const newest = current?.messages.find((message) => !message.send);
  if (!current?.hasNewer || current.loadingNewer || !newest) return;
  patchChannel(channelId, (c) => c && { ...c, loadingNewer: true });
  try {
    const page = await fetchMessages(channelId, { after: newest });
    patchChannel(
      channelId,
      (c) =>
        c && {
          ...c,
          messages: mergeMessages(c.messages, page.messages),
          hasNewer: page.hasMoreAfter ?? false,
          loadingNewer: false,
        },
    );
  } catch {
    patchChannel(channelId, (c) => c && { ...c, loadingNewer: false });
  }
}

let jumpSeq = 0;

/** Scroll to `messageId` (and flash it) once `channelId` is on screen. */
export function requestJump(channelId: string, messageId: string): void {
  jumpSeq += 1;
  setState({ jump: { channelId, messageId, seq: jumpSeq } });
}

/** The list scrolled to it; the row stays lit until clearJump. */
export function landJump(seq: number): void {
  const { jump } = getState();
  if (jump?.seq === seq) setState({ jump: { ...jump, landed: true } });
}

export function clearJump(seq: number): void {
  if (getState().jump?.seq === seq) setState({ jump: null });
}

/** Conversations by when they were last opened, most recent first. */
let recent: string[] = [];

/** The chat came to the front: subscribe, load, mark read. */
export function openChannel(channelId: string): void {
  recent = [channelId, ...recent.filter((id) => id !== channelId)];
  setState((s) => ({
    openChannelId: channelId,
    channels: evictChannels(s.channels, recent),
  }));
  subscribeChannel(channelId);
  markRead(channelId);
  readChannelActivity(channelId);
  void loadLatest(channelId);
}

export function closeChannel(channelId: string): void {
  if (getState().openChannelId !== channelId) return;
  patchChannel(channelId, (c) => c && trimChannel(c));
  setState({ openChannelId: null });
  subscribeChannel(null);
}

// ── Local changes, from gateway events and optimistic writes ──────────────

export function receiveMessage(message: ChatMessage): void {
  patchChannel(message.channel_id, (c) => {
    if (c?.status !== "ready") return c;
    // Scrolled back by a jump: only the user's own send lands (it confirms
    // a row already there); anything else arrives when paging reaches it.
    const { nonce } = message;
    const confirms =
      nonce !== undefined && c.messages.some((m) => m.id === pendingId(nonce));
    if (c.hasNewer && !confirms && !message.send) return c;
    return { ...c, messages: mergeMessages(c.messages, [message]) };
  });
}

/** What MESSAGE_UPDATE may change; an absent key is left as it was. */
export interface MessageEdit {
  content?: Message["content"];
  updated_at?: Message["updated_at"];
  embeds?: Message["embeds"];
}

export function editMessage(id: string, edit: MessageEdit): void {
  patchMessage(id, (message) => ({ ...message, ...edit }));
}

export function setSendState(id: string, send: ChatMessage["send"]): void {
  patchMessage(id, (message) => ({ ...message, send }));
}

export function removeMessage(id: string): void {
  setState((s) => {
    for (const [channelId, c] of Object.entries(s.channels)) {
      if (!c.messages.some((message) => message.id === id)) continue;
      const messages = c.messages.filter((message) => message.id !== id);
      return { channels: { ...s.channels, [channelId]: { ...c, messages } } };
    }
    return s;
  });
}

/**
 * Adds or removes one person's reaction. Idempotent, so the user's own
 * optimistic change and its gateway echo agree.
 */
export function applyReaction(
  messageId: string,
  emoji: string,
  userId: string,
  me: boolean,
  on: boolean,
): void {
  patchMessage(messageId, (message) => {
    const reactions = message.reactions ?? [];
    const existing = reactions.find((reaction) => reaction.emoji === emoji);
    const users = existing?.users ?? [];
    const has = existing
      ? (existing.users?.includes(userId) ?? (me && existing.me))
      : false;
    if (has === on) return message;
    const nextUsers = on
      ? [...users, userId]
      : users.filter((id) => id !== userId);
    const next: Reaction = {
      emoji,
      count: (existing?.count ?? 0) + (on ? 1 : -1),
      me: me ? on : (existing?.me ?? false),
      users: nextUsers,
    };
    const list = existing
      ? reactions.map((reaction) => (reaction === existing ? next : reaction))
      : [...reactions, next];
    return {
      ...message,
      reactions: list.filter((reaction) => reaction.count > 0),
    };
  });
}

// ── Typing ─────────────────────────────────────────────────────────────────

/** The server sends TYPING_START about every 3s while someone types. */
const TYPING_TTL_MS = 8000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setTyping(channelId: string, userId: string, on: boolean): void {
  setState((s) => {
    const current = s.typing[channelId] ?? [];
    const has = current.includes(userId);
    if (has === on) return s;
    const next = on
      ? [...current, userId]
      : current.filter((id) => id !== userId);
    return { typing: { ...s.typing, [channelId]: next } };
  });
}

export function startTyping(channelId: string, userId: string): void {
  const key = `${channelId}:${userId}`;
  const timer = typingTimers.get(key);
  if (timer) clearTimeout(timer);
  typingTimers.set(
    key,
    setTimeout(() => stopTyping(channelId, userId), TYPING_TTL_MS),
  );
  setTyping(channelId, userId, true);
}

/** Their message arrived, or the indicator expired. */
export function stopTyping(channelId: string, userId: string): void {
  const key = `${channelId}:${userId}`;
  const timer = typingTimers.get(key);
  if (timer) clearTimeout(timer);
  typingTimers.delete(key);
  setTyping(channelId, userId, false);
}

export function clearTypingTimers(): void {
  for (const timer of typingTimers.values()) clearTimeout(timer);
  typingTimers.clear();
}
