/**
 * Mobile Fetch Interceptor
 *
 * MUST be imported and called BEFORE any other module imports, because
 * @clerk/clerk-js captures `globalThis.fetch` at import time.
 *
 * Routes Clerk FAPI calls (identified by the `x-tauri-fetch` header)
 * through the Rust-side `fapi_proxy` Tauri command, which uses reqwest
 * directly — no WebView, no Origin header injection.
 *
 * This cleanly solves the Origin+Authorization collision that Clerk's
 * FAPI rejects on native platforms.
 */

export function installFetchInterceptor(): void {
  const originalFetch = globalThis.fetch;
  let clerkPatchedFetch: typeof globalThis.fetch | null = null;

  // Lazy-load invoke to avoid circular dependency issues at boot
  let invokePromise: Promise<typeof import("@tauri-apps/api/core")> | null = null;
  const getInvoke = () => {
    if (!invokePromise) {
      invokePromise = import("@tauri-apps/api/core");
    }
    return invokePromise;
  };

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

          if (hasTauriFetch) {
            // Route through Rust FAPI proxy — no Origin header
            try {
              const req = new Request(input, init);

              // Build clean header list
              const cleanHeaders: [string, string][] = [];
              for (const [key, value] of req.headers.entries()) {
                const lower = key.toLowerCase();
                if (lower === 'x-tauri-fetch' || lower === 'x-no-origin' || lower === 'x-mobile') {
                  continue;
                }
                cleanHeaders.push([key, value]);
              }
              cleanHeaders.push(['User-Agent', navigator.userAgent]);

              // Read body
              let body: string | null = null;
              if (req.body) {
                body = await req.text();
              }

              const { invoke } = await getInvoke();
              const result = await invoke<{
                status: number;
                headers: [string, string][];
                body: string;
              }>("plugin:clerk|fapi_proxy", {
                req: {
                  url: req.url,
                  method: req.method,
                  headers: cleanHeaders,
                  body,
                },
              });

              // Wrap Rust response into a standard Response
              const responseHeaders = new Headers();
              for (const [k, v] of result.headers) {
                responseHeaders.append(k, v);
              }

              return new Response(result.body, {
                status: result.status,
                headers: responseHeaders,
              });
            } catch (e) {
              console.error('[MobileFetch] FAPI proxy failed, falling back:', e);
              // Fallback: strip problematic headers and use browser fetch
              if (headers instanceof Headers) {
                headers.delete('x-tauri-fetch');
                headers.delete('x-mobile');
                headers.delete('x-no-origin');
                headers.delete('authorization');
              }
              return newFetch(input, init);
            }
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
