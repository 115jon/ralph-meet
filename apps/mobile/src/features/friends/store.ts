import { create } from "zustand";

import type { LoadStatus } from "@/features/servers/store";

import { RELATIONSHIP, type Relationship } from "./schema";

interface FriendsState {
  readonly status: LoadStatus;
  /** Newest first, one row per person. */
  readonly relationships: readonly Relationship[];
}

const INITIAL: FriendsState = { status: "loading", relationships: [] };

/** State only; the actions that change it live in ./actions. */
export const useFriendsStore = create<FriendsState>()(() => INITIAL);

export function resetFriendsStore(): void {
  useFriendsStore.setState(INITIAL, true);
}

/** The relationship type with `userId`, or null for none. */
export function useRelationshipType(userId: string): number | null {
  return useFriendsStore(
    (s) => s.relationships.find((r) => r.user.id === userId)?.type ?? null,
  );
}

/** Requests waiting on you: the "N pending" on the Friends row and segment. */
export function usePendingCount(): number {
  return useFriendsStore(
    (s) =>
      s.relationships.filter((r) => r.type === RELATIONSHIP.incoming).length,
  );
}
