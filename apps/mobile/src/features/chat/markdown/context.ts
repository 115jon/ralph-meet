import { createContext, useContext } from "react";

const NOBODY: ReadonlySet<string> = new Set();

/**
 * Lower-cased usernames of the conversation's people. A mention of one of
 * them sits on the accent tint; any other name (and @everyone/@here) is
 * drawn neutral, as the web's MentionBadge does for non-members.
 */
export const MembersContext = createContext<ReadonlySet<string>>(NOBODY);

export function useMemberNames(): ReadonlySet<string> {
  return useContext(MembersContext);
}

/**
 * Opens the profile behind an `@username` the conversation knows; returns
 * false for a name it does not (drawn, but not a button).
 */
export const MentionPress = createContext<
  ((username: string) => boolean) | undefined
>(undefined);

export function useMentionPress() {
  return useContext(MentionPress);
}
