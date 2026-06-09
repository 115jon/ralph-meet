export type SignInRenderState = "native-preparing" | "splash" | "form";

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
    (!nativeCookieHandoffChecked || !isLoaded || isSignedIn || hasAuthTransferCode)
  ) {
    return "native-preparing";
  }

  if (!isLoaded || isSignedIn || hasAuthTransferCode) {
    return "splash";
  }

  return "form";
}
