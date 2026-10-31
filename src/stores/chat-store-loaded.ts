/**
 * Has the chat store module been evaluated?
 *
 * The store pulls in the reducer, the REST actions and the gateway, which a
 * public page never needs. So the shared entry must not import it: code that
 * only acts once a signed-in user is in the store (the theme bootstrap)
 * waits for this flag, then loads itself. The store flips it as it is created.
 */

const listeners = new Set<() => void>();
let loaded = false;

export function markChatStoreLoaded(): void {
  if (loaded) return;
  loaded = true;
  for (const listener of listeners) listener();
}

export function subscribeChatStoreLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isChatStoreLoaded(): boolean {
  return loaded;
}
