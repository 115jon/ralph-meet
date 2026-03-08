// ============================================================================
// Platform detection & URL helpers for cross-platform deployment
//
// Web:     relative URLs ("/api/...")  — SSR, same origin
// Desktop: absolute URLs ("https://ralph-meet.workers.dev/api/...")
//          running inside Tauri system webview as client-only SPA
// ============================================================================
import { getDesktopToken } from "./desktop-auth";

/**
 * Detect whether the app is running inside a Tauri desktop shell.
 * Tauri injects `__TAURI_INTERNALS__` into the webview's window object.
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

/** True when running as a mobile app (Tauri iOS/Android) */
export function isMobile(): boolean {
  // @ts-ignore
  return typeof __IS_MOBILE__ !== "undefined" && __IS_MOBILE__ === true;
}

/** True when running as a desktop native app (Tauri macOS/Windows/Linux) */
export function isDesktop(): boolean {
  // @ts-ignore
  return typeof __IS_DESKTOP__ !== "undefined" && __IS_DESKTOP__ === true;
}

/** True when running as a standard web app (SSR or SPA in browser). */
export function isWeb(): boolean {
  return !isTauri();
}

/**
 * The API origin used by desktop/mobile clients.
 *
 * Web mode:   returns "" so relative URLs like `/api/servers` work as-is.
 * Tauri dev:  returns "" (Tauri loads the Vite dev server directly, same origin).
 * Tauri prod: returns the deployed Cloudflare Workers origin.
 *
 * Override at build time with `VITE_API_BASE_URL`.
 */
export function getApiBaseUrl(): string {
  if (isWeb()) return "";

  // Allow build-time override via Vite env var
  const envUrl =
    typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_API_BASE_URL
      : undefined;
  if (envUrl) return envUrl;

  // In Tauri dev mode, the webview uses a custom origin (tauri://localhost)
  // so relative URLs won't resolve to the Vite dev server.
  const isDev =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true;
  if (isDev) {
    if (isMobile()) {
      // On Android, use `adb reverse tcp:5173 tcp:5173` to forward the
      // device's localhost:5173 → host machine. Works over both USB and
      // wireless ADB connections.
      return "http://localhost:5173";
    }
    if (isDesktop()) {
      // In Tauri dev, we return the current origin (e.g., https://tauri.localhost)
      // to avoid mixed content errors for videos and absolute "Invalid URL" DOM exceptions.
      // Tauri's config routes `/api` natively through the proxy.
      return typeof window !== "undefined" ? window.location.origin : "";
    }
    return "http://localhost:5173";
  }

  // Production Tauri build — point to the deployed Cloudflare Workers backend
  return "https://ralph-meet.jontitor.workers.dev";
}

/**
 * Returns the WebSocket base URL (protocol + host) for real-time connections.
 *
 * Web mode:  derives from `window.location` (same origin).
 * Tauri mode: derives from `getApiBaseUrl()`, swapping http→ws / https→wss.
 */
export function getWsBaseUrl(): string {
  if (isWeb()) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  const isDev =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true;

  console.log("[platform] getWsBaseUrl:", { isDev, isDesktop: isDesktop() });

  if (isDev) {
    if (isDesktop()) {
      // Connect directly to the local dev server over WS, bypassing Tauri's scheme
      const url = "ws://localhost:1420";
      console.log("[platform] Using desktop dev ws URL:", url);
      return url;
    }
    if (isMobile()) {
      return "ws://localhost:5173";
    }
  }

  const apiBase = getApiBaseUrl();
  console.log("[platform] Falling back to apiBase:", apiBase);
  if (!apiBase) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }
  return apiBase
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:");
}

/**
 * Prefix a relative path with the API base URL.
 * Use this for all fetch/WebSocket paths to ensure cross-platform compatibility.
 *
 * @example
 *   apiUrl("/api/servers")
 *   // Web:   "/api/servers"
 *   // Tauri: "https://ralph-meet.workers.dev/api/servers"
 */
export function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

/**
 * Prefix a relative path with the WebSocket base URL.
 *
 * @example
 *   wsUrl("/api/gateway")
 *   // Web:   "wss://localhost:8888/api/gateway"
 *   // Tauri: "wss://ralph-meet.workers.dev/api/gateway"
 */
export function wsUrl(path: string): string {
  return `${getWsBaseUrl()}${path}`;
}

/**
 * Returns the web app's shareable origin for constructing URLs that users will
 * open in a regular browser (invite links, copy-image-link, etc.).
 *
 * Web:        `window.location.origin`  (same origin — e.g. the Workers URL)
 * Tauri dev:  `http://localhost:5173`   (Vite dev server proxying to Workers)
 * Tauri prod: the deployed Workers URL
 */
export function getWebOrigin(): string {
  if (isWeb()) {
    return typeof window !== "undefined" ? window.location.origin : "";
  }

  // Desktop — use the API base URL which already points to the real backend
  const base = getApiBaseUrl();
  return base || (typeof window !== "undefined" ? window.location.origin : "");
}

/**
 * Returns an absolute URL for an attachment, injecting the desktop Auth token if running in Tauri.
 * This allows <img> and <video> tags to authenticate against the backend.
 */
export function getAuthAssetUrl(pathOrUrl: string): string {
  // If it's already an absolute URL not pointing to our API, just return it
  if (pathOrUrl.startsWith("http") && !pathOrUrl.includes(getApiBaseUrl()) && !pathOrUrl.startsWith("http://localhost")) {
    return pathOrUrl;
  }

  let fullUrl = pathOrUrl;



  if (fullUrl.startsWith("/")) {
    fullUrl = apiUrl(fullUrl);
  }

  if (isTauri()) {
    const token = getDesktopToken();
    if (token) {
      try {
        const urlObj = new URL(fullUrl, window.location.origin);
        urlObj.searchParams.set("token", token);
        return urlObj.toString();
      } catch (e) {
        // Fallback
      }
    }
  }

  return fullUrl;
}

/**
 * Returns a download URL for an attachment that resolves in a system browser.
 *
 * In Tauri, `http://tauri.localhost` URLs don't resolve outside the webview,
 * so we reconstruct the URL using the real backend origin (the dev server or
 * the deployed Workers URL). The auth token is appended just like `getAuthAssetUrl`.
 */
export function getDownloadUrl(pathOrUrl: string): string {
  if (!isTauri()) {
    // On web, same-origin URLs work fine
    return getAuthAssetUrl(pathOrUrl);
  }

  // In Tauri, build a URL that points to the real backend
  let path = pathOrUrl;
  // Strip any existing origin (e.g. http://tauri.localhost/api/...)
  if (path.startsWith("http")) {
    try {
      const u = new URL(path);
      path = u.pathname + u.search;
    } catch { /* keep as-is */ }
  }

  const envUrl =
    typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_API_BASE_URL
      : undefined;

  const isDev =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true;

  // The real backend origin that resolves outside Tauri
  let backendOrigin = envUrl || "";
  if (!backendOrigin && isDev) {
    backendOrigin = "http://localhost:1420";
  }
  if (!backendOrigin) {
    // Production Tauri build — use the deployed Workers backend
    backendOrigin = "https://ralph-meet.jontitor.workers.dev";
  }

  let fullUrl = `${backendOrigin}${path}`;

  // Append auth token
  const token = getDesktopToken();
  if (token) {
    try {
      const urlObj = new URL(fullUrl);
      urlObj.searchParams.set("token", token);
      fullUrl = urlObj.toString();
    } catch { /* fallback */ }
  }

  return fullUrl;
}

/**
 * Returns a URL for media (video/audio) sources that supports range requests.
 *
 * In Tauri, the `tauri.localhost` custom protocol caches responses and breaks
 * HTTP Range requests, which prevents video seeking/scrubbing. By routing
 * media through the real backend origin (same as `getDownloadUrl`), we ensure
 * standard HTTP semantics work correctly.
 *
 * On web, this is identical to `getAuthAssetUrl`.
 */
export const getMediaUrl = getDownloadUrl;
