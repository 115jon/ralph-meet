// The web home before the Yap rename. The host stays attached to the Worker
// only so old links land somewhere: every request on it 301s to the same
// path and query on the Yap host.

import { DEFAULT_PUBLIC_WEB_URL } from "../lib/site-defaults";

const LEGACY_HOST = "meet.115jon.site";

/** A 301 to the same path and query on the Yap host for the old host, else null. */
export function legacyHostRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.host !== LEGACY_HOST) return null;

  const target = new URL(
    `${url.pathname}${url.search}`,
    DEFAULT_PUBLIC_WEB_URL,
  );
  return new Response(null, {
    status: 301,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}
