import { create } from "zustand";

import type { Author } from "@/features/chat/schema";

import type { ServerMember } from "./schema";

interface MembersState {
  /** serverId → its members, in the server's join order. */
  readonly members: Readonly<Record<string, readonly ServerMember[]>>;
  /**
   * serverId → the same people as plain authors, for mentions, the typing
   * line and who reacted. Kept beside `members` so a selector never builds
   * a new array.
   */
  readonly authors: Readonly<Record<string, readonly Author[]>>;
}

const INITIAL: MembersState = { members: {}, authors: {} };

/** State only; the actions that change it live in ./actions. */
export const useMembersStore = create<MembersState>()(() => INITIAL);

export function resetMembersStore(): void {
  useMembersStore.setState(INITIAL, true);
}

const NO_MEMBERS: readonly ServerMember[] = [];
const NO_AUTHORS: readonly Author[] = [];

export function useServerMembers(
  serverId: string | null,
): readonly ServerMember[] {
  return useMembersStore((s) =>
    serverId ? (s.members[serverId] ?? NO_MEMBERS) : NO_MEMBERS,
  );
}

/** Whether the server's list has arrived at least once. */
export function useMembersLoaded(serverId: string | null): boolean {
  return useMembersStore((s) =>
    serverId ? s.members[serverId] !== undefined : false,
  );
}

/** The server's members as authors: who can be mentioned and named. */
export function useMemberAuthors(serverId: string | null): readonly Author[] {
  return useMembersStore((s) =>
    serverId ? (s.authors[serverId] ?? NO_AUTHORS) : NO_AUTHORS,
  );
}

/** One person's membership of `serverId` (roles, joined_at), if loaded. */
export function useServerMember(
  serverId: string | null,
  userId: string,
): ServerMember | null {
  return useMembersStore((s) =>
    serverId
      ? (s.members[serverId]?.find((m) => m.user.id === userId) ?? null)
      : null,
  );
}
