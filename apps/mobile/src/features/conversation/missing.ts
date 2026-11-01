/** The next "seen" flag, and whether to close the conversation now. */
export interface MissingCheck {
  readonly seen: boolean;
  readonly close: boolean;
}

/**
 * Whether the open conversation has gone from the loaded lists. `ids` is the
 * comma-joined ids of the relevant complete list, or null while it is not
 * loaded. A conversation is only closed once it was seen in a list and is
 * now absent, so a just-created DM or a cold-start link the lists have not
 * caught up with is never closed.
 */
export function checkMissing(
  seen: boolean,
  ids: string | null,
  id: string,
): MissingCheck {
  if (ids === null) return { seen, close: false };
  if (ids.split(",").includes(id)) return { seen: true, close: false };
  return { seen, close: seen };
}
