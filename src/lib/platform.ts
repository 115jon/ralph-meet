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

  // In Tauri dev mode, the webview loads from the Vite dev server
  // (e.g. http://localhost:5173), so relative URLs already work.
  const isDev =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true;
  if (isDev) return "";

  // Production Tauri build — point to the deployed Workers backend
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

  const apiBase = getApiBaseUrl();
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
 * Returns an absolute URL for an attachment, injecting the desktop Auth token if running in Tauri.
 * This allows <img> and <video> tags to authenticate against the backend.
 */
export function getAuthAssetUrl(pathOrUrl: string): string {
  // If it's already an absolute URL not pointing to our API, just return it
  if (pathOrUrl.startsWith("http") && !pathOrUrl.includes(getApiBaseUrl()) && !pathOrUrl.startsWith("http://localhost")) {
    return pathOrUrl;
  }

  const fullUrl = pathOrUrl.startsWith("/") ? apiUrl(pathOrUrl) : pathOrUrl;

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

