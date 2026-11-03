import { useAuth, useKovaAuth } from "@kova/react";
import { useEffect, useRef } from "react";
import { recoverAppSession } from "@/lib/app-session-recovery";
import { settleAuthCodeExchange } from "@/lib/auth-code-exchange";
import { getDesktopAuthHandoffToken } from "@/lib/desktop-auth";

/**
 * Inside KovaAuthProvider: the SDK found no session behind the bearer it
 * holds (get-session answered null) while that bearer is the one Yap is
 * using. That token is dead; recover before the API and sockets find out.
 * A get-session that failed (network, 5xx) is not a verdict and is ignored.
 *
 * Only a get-session made with that bearer counts. When the SDK takes a new
 * token (a sign-in code exchange, a device sign-in) it renders once with the
 * new token and the previous token's answer ("no session") before it asks
 * again; taking that as a verdict refused every fresh sign-in token.
 */
export function useAppSessionRecovery(): void {
  const { isLoaded, isSignedIn } = useAuth();
  const { sessionToken, sessionResult, authError } = useKovaAuth();
  const sessionCheckFailed = Boolean(sessionResult.error);
  const isPending = sessionResult.isPending;
  /** The bearer a get-session has been seen in flight for. */
  const checkedToken = useRef<string | null>(null);

  // The SDK gave up on a sign-in code (bad state, invalid code).
  useEffect(() => {
    if (authError) settleAuthCodeExchange();
  }, [authError]);

  useEffect(() => {
    if (isPending) checkedToken.current = sessionToken;
  }, [isPending, sessionToken]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || sessionCheckFailed || !sessionToken) return;
    if (checkedToken.current !== sessionToken) return;
    if (sessionToken !== getDesktopAuthHandoffToken()) return;
    void recoverAppSession(sessionToken);
  }, [isLoaded, isSignedIn, sessionCheckFailed, sessionToken]);
}
