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
