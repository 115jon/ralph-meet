/**
 * useSession — current auth session state.
 *
 * Returns the raw session + user objects along with derived booleans.
 * Equivalent to Clerk's `useAuth()` but typed against kova-auth's user model.
 *
 * @example
 * ```tsx
 * const { session, isLoaded, isSignedIn } = useSession();
 * if (!isLoaded) return <Spinner />;
 * if (!isSignedIn) return <Redirect to="/sign-in" />;
 * return <Dashboard user={session.user} />;
 * ```
 */

import { useKovaAuth } from "../context";
import type { KovaSession, KovaUser, UseSessionReturn } from "../types";

export function useSession(): UseSessionReturn {
  const { sessionResult, client } = useKovaAuth();

  // Read from the shared subscription set up once in KovaAuthProvider.
  // Do NOT call client.useSession() here — each independent call creates its
  // own Better Auth subscription that fires a separate get-session request.
  const result = sessionResult;

  const isLoaded = !result.isPending;
  const isSignedIn = !!result.data?.user && !result.error;

  const session = result.data
    ? ({
      user: result.data.user as unknown as KovaUser,
      session: result.data.session as unknown as KovaSession,
    })
    : null;

  return {
    session,
    isLoaded,
    isSignedIn,
    refetch: () => result.refetch(),
  };
}
