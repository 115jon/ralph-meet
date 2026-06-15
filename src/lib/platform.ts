// ============================================================================
// Platform detection & URL helpers for cross-platform deployment
//
// Web:     relative URLs ("/api/...")  — SSR, same origin
// Desktop: absolute URLs ("https://ralph-meet.workers.dev/api/...")
//          running inside Tauri system webview as client-only SPA
// ============================================================================
import { getDesktopToken, getStoredKovaAuthSessionToken } from "./desktop-auth";
import { clog } from "@/lib/console-logger";

const log = clog("platform");

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

export type CapturePolicy = "wgc-enabled" | "hook-exclusive";

export function getCapturePolicy(): CapturePolicy {
  const value = typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
    ? import.meta.env.VITE_RALPH_CAPTURE_POLICY
    : undefined;

  return value === "hook-exclusive" ? "hook-exclusive" : "wgc-enabled";
}

export function isWgcCaptureAllowed(): boolean {
  return getCapturePolicy() === "wgc-enabled";
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

  const isDev =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true;

  if (isDev) {
    if (isMobile()) {
      return "http://localhost:5173";
    }
    if (isDesktop()) {
      // In desktop dev, fetch through the desktop Vite server. Its proxy target
      // is controlled by VITE_API_BASE_URL, so the same app can test against
      // local Meet or the deployed Worker without changing runtime code.
      return typeof window !== "undefined" ? window.location.origin : "";
    }
    return "http://localhost:5173";
  }

  // Allow build-time override via Vite env var for production
  const envUrl = typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
    ? import.meta.env.VITE_API_BASE_URL
    : undefined;
  if (envUrl) return envUrl;

  // Production Tauri build — point to the deployed Cloudflare Workers backend
  return "https://meet.115jon.site";
}

/**
 * Returns a resolvable public origin for the API that can be accessed by the system OS (out of Tauri context).
 * - Local Dev: `http://localhost:5173`
 * - Production: Custom env URL or `https://meet.115jon.site`
 */
export function getPublicApiUrl(): string {
  const envUrl = typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
    ? import.meta.env.VITE_API_BASE_URL
    : undefined;

  if (envUrl) return envUrl;

  const isDev =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true;

  if (isDev) {
    return "http://localhost:5173";
  }

  return "https://meet.115jon.site";
}

/**
 * Public web origin to open in a system browser for user-facing flows.
 *
 * This intentionally does not use the local dev server: native auth handoff
 * should happen on the deployed Ralph Meet site, then deep-link back into Tauri.
 */
export function getPublicWebUrl(): string {
  const envUrl = typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined"
    ? import.meta.env.VITE_PUBLIC_WEB_URL
    : undefined;

  return (envUrl || "https://meet.115jon.site").replace(/\/$/, "");
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

  if (isDev) {
    if (isDesktop()) {
      // Connect to the desktop Vite server; it proxies /api WebSockets to the
      // VITE_API_BASE_URL target configured for this dev run.
      const url = "ws://localhost:1420";
      log.info("Using desktop dev ws URL:", url);
      return url;
    }
    if (isMobile()) {
      return "ws://localhost:5173";
    }
  }

  const apiBase = getPublicApiUrl();
  log.info("Using ws base from apiBase:", apiBase);

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

  return getPublicApiUrl();
}

function withAuthTokenForProtectedAsset(fullUrl: string): string {
  const token = (() => {
    try {
      return getDesktopToken() ?? getStoredKovaAuthSessionToken();
    } catch {
      return null;
    }
  })();
  if (!token) return fullUrl;

  try {
    const urlObj = new URL(fullUrl, typeof window !== "undefined" ? window.location.origin : getPublicApiUrl());
    if (urlObj.pathname.startsWith("/api/attachments/") || urlObj.pathname.startsWith("/api/camera-backgrounds/")) {
      urlObj.searchParams.set("token", token);
      return urlObj.toString();
    }
  } catch {
    // Keep the original URL if URL parsing is unavailable.
  }

  return fullUrl;
}

/**
 * Returns a URL for an asset. Protected attachments include the Ralph Auth
 * session token because raw <img>/<video>/<a> requests cannot set auth headers.
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

  return withAuthTokenForProtectedAsset(fullUrl);
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

  // The real backend origin that resolves outside Tauri
  const backendOrigin = getPublicApiUrl();

  const fullUrl = `${backendOrigin}${path}`;

  return withAuthTokenForProtectedAsset(fullUrl);
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
