/**
 * Monkey-patches globalThis.fetch to intercept Tauri v2's IPC calls for the HTTP plugin.
 * Fixes an issue where `tauri-plugin-clerk` fails to detect the IPC call on newer Tauri versions
 * (because the URL is /plugin:__TAURI_CHANNEL__|fetch instead of /plugin:http|fetch).
 * This strips the Origin header automatically added by the HTTP plugin which causes Clerk's FAPI to reject it.
 */
export const patchClerkTauri = () => {
  if (typeof globalThis.fetch !== "function") return;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input instanceof Request) {
      url = input.url;
    }

    if (
      url.includes("/plugin:__TAURI_CHANNEL__|fetch") ||
      url.includes("/plugin:http|fetch")
    ) {
      if (init && typeof init.body === "string") {
        try {
          const payload = JSON.parse(init.body);
          if (
            payload?.clientConfig?.headers &&
            Array.isArray(payload.clientConfig.headers)
          ) {
            const existingHeaders: [string, string][] = payload.clientConfig.headers;
            const hasAuth = existingHeaders.some(
              (h) => h[0].toLowerCase() === "authorization"
            );

            // Check if Origin exists at all
            const hasOrigin = existingHeaders.some(
              (h) => h[0].toLowerCase() === "origin"
            );

            if (hasAuth && hasOrigin) {
              payload.clientConfig.headers = existingHeaders.filter(
                (h) => h[0].toLowerCase() !== "origin"
              );
              init.body = JSON.stringify(payload);
            }
          }
        } catch (e) {
          // Ignore JSON errors or structure mismatches
          console.warn("[Clerk Patch] Error patching IPC fetch:", e);
        }
      }
    }

    return originalFetch(input, init);
  };
};
