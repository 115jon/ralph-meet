/**
 * Shim for `@clerk/backend` in the desktop SPA build.
 */
export function verifyToken(): Promise<null> {
  return Promise.resolve(null);
}

export function createClerkClient() {
  return new Proxy({}, {
    get: () => () => Promise.resolve(null),
  });
}
