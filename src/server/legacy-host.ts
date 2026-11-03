// The old web home (meet.115jon.site) stays attached to the Worker during the
// move to yap.115jon.com. Browser page loads there 301 to the same path on the
// new host. Everything a client calls (API, sockets, auth callbacks, share
// pages, assetlinks, static assets) is still served on the old host, because
// installed desktop and mobile builds keep calling it until they update.

import {
  DEFAULT_PUBLIC_WEB_URL,
  LEGACY_PUBLIC_WEB_URL,
} from "../lib/site-defaults";

const LEGACY_HOST = new URL(LEGACY_PUBLIC_WEB_URL).host;

/** Query params that carry a Kova sign-in back to the origin that started it. */
const AUTH_CALLBACK_PARAMS = ["kova_auth_code", "ralph_auth_code", "code"];

/** Paths always served on the old host, never redirected. */
const SERVED_PREFIXES = ["/api/", "/share/", "/.well-known/"];

/** A 301 to the new host for a browser page load on the old host, else null. */
export function legacyHostRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.host !== LEGACY_HOST) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (request.headers.get("Upgrade")) return null;
  // Only top-level navigations: not fetches, assets, or crawlers.
  if (request.headers.get("Sec-Fetch-Mode") !== "navigate") return null;
  if (SERVED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return null;
  }
  // A sign-in finishes on the origin that started it (its storage holds the
  // session the callback completes).
  if (AUTH_CALLBACK_PARAMS.some((name) => url.searchParams.has(name))) {
    return null;
  }

  const target = new URL(
    `${url.pathname}${url.search}`,
    DEFAULT_PUBLIC_WEB_URL,
  );
  return new Response(null, {
    status: 301,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}
