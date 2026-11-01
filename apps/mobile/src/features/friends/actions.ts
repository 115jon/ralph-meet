import { ApiError } from "@/lib/api";
import { showToast } from "@/ui";

import {
  deleteRelationship,
  fetchRelationships,
  postFriendRequest,
  putAccept,
  putBlock,
} from "./api";
import { addFriendError, personName } from "./filters";
import { RELATIONSHIP, type FriendUser, type Relationship } from "./schema";
import { useFriendsStore } from "./store";

const { getState, setState } = useFriendsStore;

/** Loads every relationship; the list on screen stays while it reloads. */
export async function loadFriends(): Promise<void> {
  if (getState().relationships.length === 0) setState({ status: "loading" });
  try {
    const relationships = await fetchRelationships();
    setState({ status: "ready", relationships });
  } catch {
    if (getState().relationships.length === 0) setState({ status: "error" });
  }
}

/** Puts `relationship` first, replacing any row for the same person. */
export function upsertRelationship(relationship: Relationship): void {
  setState((s) => ({
    relationships: [
      relationship,
      ...s.relationships.filter((r) => r.user.id !== relationship.user.id),
    ],
  }));
}

export function dropRelationship(userId: string): void {
  setState((s) => ({
    relationships: s.relationships.filter((r) => r.user.id !== userId),
  }));
}

function relationshipWith(userId: string): Relationship | undefined {
  return getState().relationships.find((r) => r.user.id === userId);
}

/**
 * Shows `change` at once, runs `request`, and puts the old row back with a
 * toast if the server refuses. The gateway's RELATIONSHIP_* echo confirms.
 */
async function optimistic(
  userId: string,
  change: () => void,
  request: () => Promise<void>,
  failure: string,
): Promise<boolean> {
  const before = relationshipWith(userId);
  change();
  try {
    await request();
    return true;
  } catch {
    if (before) upsertRelationship(before);
    else dropRelationship(userId);
    showToast({ label: "Not saved", text: failure, led: "danger" });
    return false;
  }
}

export type FriendRequestOutcome =
  | { readonly ok: true; readonly accepted: boolean }
  | { readonly ok: false; readonly error: string };

/** Sends a request by exact username (or accepts theirs if they asked). */
export async function sendFriendRequest(
  username: string,
): Promise<FriendRequestOutcome> {
  try {
    const result = await postFriendRequest(username.trim());
    upsertRelationship(result);
    const accepted = result.type === RELATIONSHIP.friend;
    showToast({
      label: accepted ? "Friends" : "Request sent",
      text: accepted
        ? `You and ${personName(result.user)} are friends`
        : `Request sent to ${result.user.username}`,
      led: "talk",
    });
    return { ok: true, accepted };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : null;
    return { ok: false, error: addFriendError(status) };
  }
}

export function acceptFriend(user: FriendUser): Promise<boolean> {
  return optimistic(
    user.id,
    () => upsertRelationship({ user, type: RELATIONSHIP.friend }),
    () => putAccept(user.id),
    `${personName(user)}'s request is still waiting. Try again.`,
  );
}

/** Ignore theirs, cancel yours, remove a friend or unblock: one DELETE. */
export function removeRelationship(user: FriendUser): Promise<boolean> {
  return optimistic(
    user.id,
    () => dropRelationship(user.id),
    () => deleteRelationship(user.id),
    `Nothing changed with ${personName(user)}. Try again.`,
  );
}

export function blockUser(user: FriendUser): Promise<boolean> {
  return optimistic(
    user.id,
    () => upsertRelationship({ user, type: RELATIONSHIP.blocked }),
    () => putBlock(user.id),
    `${personName(user)} isn't blocked. Try again.`,
  );
}
