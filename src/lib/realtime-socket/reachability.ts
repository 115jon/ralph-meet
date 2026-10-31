// ── Server reachable ────────────────────────────────────────────────────────
// After an outage each realtime socket finds the server again only when its
// own backoff timer fires, and the chat socket's can be 30 s out. So when one
// socket gets through (its ticket request succeeds or its socket opens), it
// says so here and every socket still waiting out a backoff retries now, as
// wake() would. Only sockets in a backoff wait listen, and each hears one
// signal per wait: a stopped, given-up or signed-out socket is never woken,
// and a retry that fails waits (and listens) again.

export interface ServerReachability {
  /**
   * Calls `retry` once, on the next reachable(). Returns a cancel function;
   * call it when the wait ends any other way.
   */
  onNextReachable(retry: () => void): () => void;
  /** A socket got through to the server. */
  reachable(): void;
}

export function createServerReachability(): ServerReachability {
  const waiting = new Set<{ readonly retry: () => void }>();
  return {
    onNextReachable(retry) {
      const entry = { retry };
      waiting.add(entry);
      return () => {
        waiting.delete(entry);
      };
    },
    reachable() {
      if (waiting.size === 0) return;
      const woken = [...waiting];
      waiting.clear();
      for (const entry of woken) {
        try {
          entry.retry();
        } catch (error) {
          // One socket's hook failing must not leave the others waiting.
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    },
  };
}

/** Shared by every realtime socket in the page. */
export const serverReachability = createServerReachability();
