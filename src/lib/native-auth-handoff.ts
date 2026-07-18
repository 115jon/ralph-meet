export type SignInRenderState = "native-preparing" | "splash" | "form";

export function isSupportedNativeAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ralphmeet:" &&
      url.hostname === "auth" &&
      (url.pathname === "" || url.pathname === "/") &&
      !url.searchParams.has("session_token")
    );
  } catch {
    return false;
  }
}

export type SignInRedirectDecisionInput = {
  isNativeHandoff: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  hasStoredBrowserToken: boolean;
};

export function shouldCompletePostSignInRedirect({
  isNativeHandoff,
  isLoaded,
  isSignedIn,
  hasStoredBrowserToken,
}: SignInRedirectDecisionInput): boolean {
  if (isNativeHandoff) {
    return isLoaded && isSignedIn;
  }

  return hasStoredBrowserToken || (isLoaded && isSignedIn);
}

export type SignInRenderDecisionInput = {
  isNativeHandoff: boolean;
  nativeCookieHandoffChecked: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  hasAuthTransferCode: boolean;
};

export function getSignInRenderState({
  isNativeHandoff,
  nativeCookieHandoffChecked,
  isLoaded,
  isSignedIn,
  hasAuthTransferCode,
}: SignInRenderDecisionInput): SignInRenderState {
  if (
    isNativeHandoff &&
    (!nativeCookieHandoffChecked ||
      !isLoaded ||
      isSignedIn ||
      hasAuthTransferCode)
  ) {
    return "native-preparing";
  }

  if (!isLoaded || isSignedIn || hasAuthTransferCode) {
    return "splash";
  }

  return "form";
}
