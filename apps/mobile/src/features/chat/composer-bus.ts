// "Mention" from a profile or member row, which live outside the chat:
// the open conversation's composer registers here and takes the text.

type Insert = (text: string) => void;

let insert: Insert | null = null;

/** The open chat's composer takes inserts; returns the unregister. */
export function registerComposerInsert(next: Insert): () => void {
  insert = next;
  return () => {
    if (insert === next) insert = null;
  };
}

/** Puts `@username ` at the composer's cursor; false with no chat open. */
export function mentionInComposer(username: string): boolean {
  if (!insert) return false;
  insert(`@${username} `);
  return true;
}
