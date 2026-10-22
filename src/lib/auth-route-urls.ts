import { getPublicWebUrl } from "@/lib/platform";

export type AuthRouteSearch = {
  redirect_url?: string;
  /**
   * @deprecated Leftover from the deep-link desktop sign-in. Desktop now uses
   * device-code sign-in; this is only passed through by /sign-up until that
   * route drops it.
   */
  native_handoff?: string;
};

const DEFAULT_REDIRECT = "/chat";

/**
 * Where to send the user after sign-in or sign-up. `redirect_url` comes from
 * the query string, so anyone can set it. Only same-origin paths and absolute
 * URLs on one of `allowedOrigins` pass; everything else (other sites,
 * protocol-relative `//host`, `javascript:`, custom schemes) falls back to /chat.
 */
export function sanitizeRedirectUrl(
  raw: string | undefined,
  allowedOrigins: readonly string[],
): string {
  if (!raw) return DEFAULT_REDIRECT;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_REDIRECT;
  if (raw.startsWith("/")) {
    return raw.startsWith("//") ? DEFAULT_REDIRECT : raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_REDIRECT;
    }
    const allowed = allowedOrigins.some((origin) => {
      try {
        return new URL(origin).origin === url.origin;
      } catch {
        return false;
      }
    });
    return allowed ? url.toString() : DEFAULT_REDIRECT;
  } catch {
    return DEFAULT_REDIRECT;
  }
}

/** Origins an absolute redirect may point at: the app itself, wherever it runs. */
export function redirectOrigins(): string[] {
  const origins = [getPublicWebUrl()];
  if (typeof window !== "undefined") origins.push(window.location.origin);
  return origins;
}

export function buildAuthRouteUrl(
  route: "/sign-in" | "/sign-up",
  search: AuthRouteSearch,
): string {
  const params = new URLSearchParams();

  if (search.redirect_url) {
    params.set("redirect_url", search.redirect_url);
  }

  if (search.native_handoff) {
    params.set("native_handoff", search.native_handoff);
  }

  const query = params.toString();
  return query ? `${route}?${query}` : route;
}

export function buildPostAuthSignInUrl(
  redirectUrl: string,
  nativeHandoff?: string,
): string {
  return buildAuthRouteUrl("/sign-in", {
    redirect_url: redirectUrl,
    native_handoff: nativeHandoff,
  });
}
