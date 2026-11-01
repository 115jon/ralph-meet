import { useAuth, useKovaAuth } from "@kova/react";
import { useEffect } from "react";
import { recoverAppSession } from "@/lib/app-session-recovery";
import { getDesktopAuthHandoffToken } from "@/lib/desktop-auth";

/**
 * Inside KovaAuthProvider: the SDK found no session behind the bearer it
 * holds (get-session answered null) while that bearer is the one Ralph is
 * using. That token is dead; recover before the API and sockets find out.
 * A get-session that failed (network, 5xx) is not a verdict and is ignored.
 */
export function useAppSessionRecovery(): void {
  const { isLoaded, isSignedIn } = useAuth();
  const { sessionToken, sessionResult } = useKovaAuth();
  const sessionCheckFailed = Boolean(sessionResult.error);

  useEffect(() => {
    if (!isLoaded || isSignedIn || sessionCheckFailed || !sessionToken) return;
    if (sessionToken !== getDesktopAuthHandoffToken()) return;
    void recoverAppSession(sessionToken);
  }, [isLoaded, isSignedIn, sessionCheckFailed, sessionToken]);
}
