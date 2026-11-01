import { RELATIONSHIP, type FriendUser, type Relationship } from "./schema";

// The web Friends view's tabs and branches (src/components/chat/FriendsView.tsx):
// Online, All, Pending (Incoming, then Sent) and Blocked, filtered by a
// search on name and username.

export const FRIEND_TABS = ["online", "all", "pending", "blocked"] as const;
export type FriendTab = (typeof FRIEND_TABS)[number];

export const FRIEND_TAB_LABEL: Record<FriendTab, string> = {
  online: "Online",
  all: "All",
  pending: "Pending",
  blocked: "Blocked",
};

export interface FriendBranch {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly Relationship[];
}

/** Display name or username, as the web names a person. */
export function personName(
  user: Pick<FriendUser, "display_name" | "username">,
): string {
  return user.display_name?.trim() || user.username;
}

function matches(user: FriendUser, query: string): boolean {
  if (!query) return true;
  return (
    user.username.toLowerCase().includes(query) ||
    personName(user).toLowerCase().includes(query)
  );
}

function byName(a: Relationship, b: Relationship): number {
  return personName(a.user).localeCompare(personName(b.user));
}

/**
 * The branches for `tab`. `isOnline` is live presence: the web's Online tab
 * reads the row's own status, which here the gateway keeps current.
 */
export function friendBranches(
  relationships: readonly Relationship[],
  tab: FriendTab,
  rawQuery: string,
  isOnline: (userId: string) => boolean,
): FriendBranch[] {
  const query = rawQuery.trim().toLowerCase();
  const rows = relationships.filter((r) => matches(r.user, query));
  const of = (type: number) => rows.filter((r) => r.type === type).sort(byName);
  switch (tab) {
    case "online": {
      const online = of(RELATIONSHIP.friend).filter((r) => isOnline(r.user.id));
      return [{ key: "online", label: "Online", rows: online }];
    }
    case "all":
      return [
        { key: "all", label: "All friends", rows: of(RELATIONSHIP.friend) },
      ];
    case "pending":
      return [
        { key: "incoming", label: "Incoming", rows: of(RELATIONSHIP.incoming) },
        { key: "sent", label: "Sent", rows: of(RELATIONSHIP.outgoing) },
      ].filter((branch) => branch.rows.length > 0);
    case "blocked":
      return [
        { key: "blocked", label: "Blocked", rows: of(RELATIONSHIP.blocked) },
      ];
  }
}

/** Add-friend refusals in the person's terms (the web's addFriendError). */
export function addFriendError(status: number | null): string {
  if (status === 404)
    return "No one has that username. Check the spelling and try again.";
  if (status === 400) return "You can't add yourself.";
  if (status === 409)
    return "You're already friends, have a request pending, or blocked this person.";
  return "The request didn't go through. Check the connection and try again.";
}
