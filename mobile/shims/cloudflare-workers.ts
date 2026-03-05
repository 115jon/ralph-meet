/**
 * Shim for `cloudflare:workers` imports in the desktop SPA build.
 *
 * The web app's cache.ts imports `env` from `cloudflare:workers` which is
 * only available in the Cloudflare Workers runtime. In the desktop SPA,
 * all data fetching goes through the remote API, so the cache module is
 * never called — but the import still needs to resolve at build time.
 */
export const env = new Proxy(
  {},
  {
    get(_target, prop) {
      console.warn(
        `[Desktop Shim] Attempted to access cloudflare:workers.env.${String(prop)} — not available in desktop mode`
      );
      return undefined;
    },
  }
);
