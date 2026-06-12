export type AuthRouteSearch = {
  redirect_url?: string;
  native_handoff?: string;
};

export function buildAuthRouteUrl(route: "/sign-in" | "/sign-up", search: AuthRouteSearch): string {
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

export function buildPostAuthSignInUrl(redirectUrl: string, nativeHandoff?: string): string {
  return buildAuthRouteUrl("/sign-in", {
    redirect_url: redirectUrl,
    native_handoff: nativeHandoff,
  });
}
