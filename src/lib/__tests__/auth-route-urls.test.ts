import { describe, expect, it } from "vitest";
import { buildAuthRouteUrl, buildPostAuthSignInUrl } from "../auth-route-urls";

describe("auth route URL helpers", () => {
  it("omits search params when no redirect context is present", () => {
    expect(buildAuthRouteUrl("/sign-up", {})).toBe("/sign-up");
  });

  it("preserves redirect and native handoff context across auth routes", () => {
    expect(
      buildAuthRouteUrl("/sign-up", {
        redirect_url: "ralphmeet://auth",
        native_handoff: "1",
      }),
    ).toBe("/sign-up?redirect_url=ralphmeet%3A%2F%2Fauth&native_handoff=1");
  });

  it("routes post-signup completion back through sign-in", () => {
    expect(buildPostAuthSignInUrl("/chat")).toBe("/sign-in?redirect_url=%2Fchat");
  });

  it("keeps desktop handoff context during post-signup completion", () => {
    expect(buildPostAuthSignInUrl("ralphmeet://auth", "1")).toBe(
      "/sign-in?redirect_url=ralphmeet%3A%2F%2Fauth&native_handoff=1",
    );
  });
});
