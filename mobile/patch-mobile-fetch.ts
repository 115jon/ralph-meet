/**
 * Mobile Fetch Interceptor
 *
 * The Tauri native HTTP path (plugin-http) always injects an Origin header
 * from the Rust side, and Clerk's FAPI rejects requests with both Origin
 * and Authorization. Since we can't remove Origin from the Rust side,
 * we route ALL Clerk FAPI calls through browser fetch.
 *
 * For the initial /v1/environment and /v1/client refresh calls, we return
 * the cached data from the Rust init to prevent Clerk from overwriting
 * the active session with an unauthenticated response.
 *
 * For session token refresh calls (/v1/client/sessions/.../tokens), we
 * let them through without auth — Clerk handles token expiry gracefully.
 */

import { invoke } from "@tauri-apps/api/core";

// Cached init data — populated on first use
let cachedInitData: { client: unknown; environment: unknown } | null = null;

async function getCachedInitData() {
  if (!cachedInitData) {
    try {
      const data = await invoke<{ client: unknown; environment: unknown; publishableKey: string }>(
        "plugin:clerk|initialize"
      );
      cachedInitData = { client: data.client, environment: data.environment };
    } catch {
      // If Rust init fails, let the real fetch handle it
      return null;
    }
  }
  return cachedInitData;
}

export function installFetchInterceptor(): void {
  const originalFetch = globalThis.fetch;
  let clerkPatchedFetch: typeof globalThis.fetch | null = null;

  Object.defineProperty(globalThis, 'fetch', {
    get() {
      return clerkPatchedFetch ?? originalFetch;
    },
    set(newFetch: typeof globalThis.fetch) {
      if (newFetch !== originalFetch && !clerkPatchedFetch) {
        console.log('[MobileFetch] Intercepted patchFetch installation');

        clerkPatchedFetch = async function interceptedFetch(
          input: RequestInfo | URL,
          init?: RequestInit
        ): Promise<Response> {
          const headers = init?.headers;
          let hasTauriFetch = false;

          if (headers) {
            if (headers instanceof Headers) {
              hasTauriFetch = headers.has('x-tauri-fetch');
            } else if (Array.isArray(headers)) {
              hasTauriFetch = headers.some(h => h[0] === 'x-tauri-fetch');
            } else {
              hasTauriFetch = !!(headers as Record<string, string>)['x-tauri-fetch'];
            }
          }

          if (hasTauriFetch && headers instanceof Headers) {
            const urlStr = typeof input === 'string' ? input
              : input instanceof Request ? input.url
                : input.toString();

            // Parse the Clerk FAPI URL to identify the call type
            let pathname = '';
            try { pathname = new URL(urlStr).pathname; } catch { /* ignore */ }

            // For /v1/environment and /v1/client init calls: return cached
            // data from Rust to preserve session state. Without auth header,
            // Clerk's FAPI returns a fresh client with no active session,
            // which would overwrite our cached logged-in state.
            if (pathname === '/v1/environment' || pathname === '/v1/client') {
              const cached = await getCachedInitData();
              if (cached) {
                const body = pathname === '/v1/environment'
                  ? cached.environment
                  : cached.client;
                console.log(`[MobileFetch] Returning cached response for ${pathname}`);
                return new Response(JSON.stringify({ response: body }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                });
              }
            }

            // For all other Clerk FAPI calls: strip problematic headers
            // and route through browser fetch
            headers.delete('x-tauri-fetch');
            headers.delete('x-mobile');
            headers.delete('x-no-origin');
            headers.delete('authorization');
          }

          return newFetch(input, init);
        } as typeof globalThis.fetch;
      } else {
        clerkPatchedFetch = newFetch;
      }
    },
    configurable: true,
    enumerable: true,
  });

  console.log('[MobileFetch] Fetch interceptor installed (pre-module-load)');
}
