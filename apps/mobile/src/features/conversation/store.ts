import { Schema } from "effect";
import { create } from "zustand";

import { showDms, showServer } from "@/features/home/pane";
import { useServersStore } from "@/features/servers/store";
import { readPersisted, writePersisted } from "@/lib/persist";

// Which conversation the home pager holds, and which of its three pages is
// in front: the drawer (rail, tree or DMs, your panel), the chat, or a
// channel's members. The routes /channel/[id] and /dm/[id] only set this;
// the pager does the rest. The conversation is remembered across launches,
// so the app reopens on it. Friends opens in the chat's slot, like a DM.

/** The Friends page's conversation id: there is only one. */
export const FRIENDS_ID = "friends";

const Conversation = Schema.Struct({
  kind: Schema.Literals(["channel", "dm", "friends"]),
  id: Schema.String,
  /** A channel's name before its tree loads (from a link or push). */
  name: Schema.optional(Schema.String),
});
export type Conversation = typeof Conversation.Type;

export type HomePage = "drawer" | "chat" | "members";

interface ConversationState {
  readonly current: Conversation | null;
  readonly page: HomePage;
}

const STORAGE = "conversation";
const saved = readPersisted(STORAGE, Conversation);

const useConversationStore = create<ConversationState>()(() => ({
  current: saved,
  page: saved ? "chat" : "drawer",
}));

const { getState, setState } = useConversationStore;

let stopReveal: (() => void) | null = null;

/**
 * Points the drawer at `conversation`: its server's tree, or the DM list.
 * A channel whose tree has not loaded yet (a cold-start link) is revealed
 * as soon as it does.
 */
export function revealConversation(conversation: Conversation): void {
  stopReveal?.();
  stopReveal = null;
  if (conversation.kind !== "channel") {
    showDms();
    return;
  }
  const serverOf = (s: ReturnType<typeof useServersStore.getState>) =>
    Object.keys(s.trees).find((id) =>
      s.trees[id]?.channels.some((c) => c.id === conversation.id),
    );
  const found = serverOf(useServersStore.getState());
  if (found) {
    showServer(found);
    return;
  }
  const unsubscribe = useServersStore.subscribe((s) => {
    const serverId = serverOf(s);
    if (!serverId) return;
    unsubscribe();
    stopReveal = null;
    showServer(serverId);
  });
  stopReveal = unsubscribe;
}

/** Opens `conversation` on the chat page. */
export function openConversation(conversation: Conversation): void {
  const current = getState().current;
  const same =
    current?.id === conversation.id && current.kind === conversation.kind;
  setState({
    current: same
      ? { ...conversation, name: conversation.name ?? current.name }
      : conversation,
    page: "chat",
  });
  if (!same) {
    writePersisted(STORAGE, conversation);
    revealConversation(conversation);
  }
}

/** Opens the Friends page in the chat's slot. */
export function openFriends(): void {
  openConversation({ kind: "friends", id: FRIENDS_ID });
}

/** A server channel is open: it has a members page. */
function hasMembers(current: Conversation | null): boolean {
  return current?.kind === "channel";
}

/** Slides to the open channel's members; nothing else has a members page. */
export function showMembers(): void {
  const { current, page } = getState();
  if (hasMembers(current) && page !== "members") setState({ page: "members" });
}

/** The header's members key: open them, or back to the chat. */
export function toggleMembers(): void {
  if (getState().page === "members") showChat();
  else showMembers();
}

export function showDrawer(): void {
  if (getState().page !== "drawer") setState({ page: "drawer" });
}

/** Back to the chat; with no conversation open there is nothing to show. */
export function showChat(): void {
  const { current, page } = getState();
  if (current && page !== "chat") setState({ page: "chat" });
}

export function setHomePage(page: HomePage): void {
  if (page === "chat") showChat();
  else if (page === "members") showMembers();
  else showDrawer();
}

/** Sign-out: forget the conversation on this device. */
export function resetConversation(): void {
  stopReveal?.();
  stopReveal = null;
  setState({ current: null, page: "drawer" });
  writePersisted(STORAGE, null);
}

export function useConversation(): Conversation | null {
  return useConversationStore((s) => s.current);
}

export function useHomePage(): HomePage {
  return useConversationStore((s) => s.page);
}

export function getConversation(): Conversation | null {
  return getState().current;
}

export function getHomePage(): HomePage {
  return getState().page;
}

/** The open conversation has a members page (a server channel). */
export function useHasMembers(): boolean {
  return useConversationStore((s) => hasMembers(s.current));
}

/** The conversation is the open one: its tree or DM row reads as selected. */
export function useIsCurrentConversation(id: string): boolean {
  return useConversationStore((s) => s.current?.id === id);
}
