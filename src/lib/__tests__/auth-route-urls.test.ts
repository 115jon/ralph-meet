import { describe, expect, it } from "vitest";
import * as authRouteUrls from "../auth-route-urls";
import {
  buildAuthRouteUrl,
  buildPostAuthSignInUrl,
  sanitizeRedirectUrl,
} from "../auth-route-urls";

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

describe("sanitizeRedirectUrl", () => {
  const origins = ["https://meet.115jon.site"];

  it("keeps same-origin paths, including query strings", () => {
    expect(sanitizeRedirectUrl("/activate?code=ABCD-EFGH", origins)).toBe(
      "/activate?code=ABCD-EFGH",
    );
  });

  it("falls back to /chat when there is no redirect", () => {
    expect(sanitizeRedirectUrl(undefined, origins)).toBe("/chat");
    expect(sanitizeRedirectUrl("", origins)).toBe("/chat");
  });

  it.each([
    "//evil.example/path",
    "https://evil.example/",
    "javascript:alert(1)",
    "ralphmeet://auth",
    "/\\evil.example",
    "/chat\u0000",
  ])("rejects %s", (value) => {
    expect(sanitizeRedirectUrl(value, origins)).toBe("/chat");
  });

  it("allows absolute URLs on an allowed origin", () => {
    expect(
      sanitizeRedirectUrl("https://meet.115jon.site/chat?x=1", origins),
    ).toBe("https://meet.115jon.site/chat?x=1");
  });
});
