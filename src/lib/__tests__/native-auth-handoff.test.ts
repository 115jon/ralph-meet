import { describe, expect, it } from "vitest";

import {
  getSignInRenderState,
  shouldCompletePostSignInRedirect,
} from "@/lib/native-auth-handoff";

describe("native auth handoff decisions", () => {
  it("renders the sign-in form after native cookie handoff fails while the browser is signed out", () => {
    expect(
      shouldCompletePostSignInRedirect({
        isNativeHandoff: true,
        isLoaded: true,
        isSignedIn: false,
        hasStoredBrowserToken: false,
      }),
    ).toBe(false);

    expect(
      getSignInRenderState({
        isNativeHandoff: true,
        nativeCookieHandoffChecked: true,
        isLoaded: true,
        isSignedIn: false,
        hasAuthTransferCode: false,
      }),
    ).toBe("form");
  });

  it("keeps the native preparing screen while the cookie handoff check is still pending", () => {
    expect(
      getSignInRenderState({
        isNativeHandoff: true,
        nativeCookieHandoffChecked: false,
        isLoaded: true,
        isSignedIn: false,
        hasAuthTransferCode: false,
      }),
    ).toBe("native-preparing");
  });

  it("continues native handoff when the browser is signed in", () => {
    expect(
      shouldCompletePostSignInRedirect({
        isNativeHandoff: true,
        isLoaded: true,
        isSignedIn: true,
        hasStoredBrowserToken: false,
      }),
    ).toBe(true);

    expect(
      getSignInRenderState({
        isNativeHandoff: true,
        nativeCookieHandoffChecked: true,
        isLoaded: true,
        isSignedIn: true,
        hasAuthTransferCode: false,
      }),
    ).toBe("native-preparing");
  });

  it("keeps existing web redirect behavior for stored browser tokens", () => {
    expect(
      shouldCompletePostSignInRedirect({
        isNativeHandoff: false,
        isLoaded: false,
        isSignedIn: false,
        hasStoredBrowserToken: true,
      }),
    ).toBe(true);
  });

  it("uses the splash state for normal web auth loading", () => {
    expect(
      getSignInRenderState({
        isNativeHandoff: false,
        nativeCookieHandoffChecked: false,
        isLoaded: false,
        isSignedIn: false,
        hasAuthTransferCode: false,
      }),
    ).toBe("splash");
  });
});
