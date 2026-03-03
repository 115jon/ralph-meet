/**
 * Shim for `@clerk/tanstack-react-start/server` in the desktop SPA build.
 *
 * Server-side Clerk auth functions are never called in the desktop client.
 */
export async function auth() {
  return { userId: null, sessionId: null };
}

export function getAuth() {
  return { userId: null, sessionId: null };
}

/** No-op clerkClient proxy */
export const clerkClient = new Proxy(
  {},
  {
    get(_target, prop) {
      return new Proxy(() => Promise.resolve(null), {
        get: () => () => Promise.resolve(null),
      });
    },
  }
);

export function createClerkClient() {
  return clerkClient;
}
