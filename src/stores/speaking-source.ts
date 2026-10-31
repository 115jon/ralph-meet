/**
 * Who is speaking, readable without the chat store.
 *
 * The speaking set lives in the chat store, but Avatar (and so every public
 * page that draws one) only needs to ask "is this user speaking?". Importing
 * the store for that would drag its reducer, REST actions and gateway into
 * the page. So the question goes through this seam: the store registers
 * itself as the source when it loads (chat-store.ts), and until then nobody
 * is speaking.
 */

export type SpeakingSource = {
  /** Called on every store change; return the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  isSpeaking: (userId: string) => boolean;
};

const listeners = new Set<() => void>();
let source: SpeakingSource | null = null;
let detach: (() => void) | null = null;

export function registerSpeakingSource(next: SpeakingSource): void {
  detach?.();
  source = next;
  detach = next.subscribe(() => {
    for (const listener of listeners) listener();
  });
  // Leaves mounted before the store loaded re-check their flag.
  for (const listener of listeners) listener();
}

export function subscribeSpeaking(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readIsSpeaking(userId: string | null | undefined): boolean {
  return !!userId && (source?.isSpeaking(userId) ?? false);
}
