import { describe, expect, it } from "vitest";
import * as authRouteUrls from "../auth-route-urls";
import { buildAuthRouteUrl, buildPostAuthSignInUrl } from "../auth-route-urls";

describe("auth route URL helpers", () => {
  it("omits search params when no redirect context is present", () => {
    expect(buildAuthRouteUrl("/sign-up", {})).toBe("/sign-up");
  });

  it("preserves the redirect target across auth routes", () => {
    expect(buildAuthRouteUrl("/sign-up", { redirect_url: "/invite/abc" })).toBe(
      "/sign-up?redirect_url=%2Finvite%2Fabc",
    );
  });

  it("routes post-signup completion back through sign-in", () => {
    expect(buildPostAuthSignInUrl("/chat")).toBe(
      "/sign-in?redirect_url=%2Fchat",
    );
  });

  it("no longer builds deep-link desktop sign-in URLs", () => {
    expect("buildDesktopSignInUrl" in authRouteUrls).toBe(false);
  });
});
