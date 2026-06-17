/**
 * useSignUp — imperative sign-up actions.
 *
 * Supports email/password registration with optional username.
 * After successful registration, the user is redirected to `afterSignUpUrl`
 * (from provider config) unless overridden per-call.
 *
 * Now includes rate-limit awareness: when the server returns 429, the hook
 * parses the `Retry-After` response header and exposes `retryAfterSeconds`
 * in the return value so callers can present an accurate countdown to the user.
 */

import { useCallback, useState } from "react";
import { useKovaAuth } from "../context";
import { extractRetryAfter } from "./use-rate-limit";

interface SignUpEmailOpts {
  email: string;
  password: string;
  name: string;
  username?: string;
  callbackURL?: string;
}

export interface UseSignUpReturn {
  signUp: {
    /** Register a new account with email + password. */
    email: (opts: SignUpEmailOpts) => Promise<void>;
  };
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  /**
   * `true` after successful registration when email verification is required.
   * Show a "check your email" message in this state.
   */
  verificationPending: boolean;
  /**
   * Set to the `Retry-After` value (in seconds) when the server returns 429.
   * `null` when not rate-limited.
   *
   * Pass this to `useRateLimit().recordRateLimit()` to start a countdown,
   * or use the convenience `<RateLimitBanner>` component directly.
   */
  retryAfterSeconds: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMessage(err: unknown): string {
  if (!err) return "An unexpected error occurred.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof (err as { message?: unknown }).message === "string")
    return (err as { message: string }).message;
  if (typeof (err as { error?: { message?: unknown } }).error?.message === "string")
    return (err as { error: { message: string } }).error.message;
  return "An unexpected error occurred.";
}

function is429(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const a = err as Record<string, unknown>;
  if (a["status"] === 429) return true;
  const inner = a["error"] as Record<string, unknown> | undefined;
  if (inner?.["status"] === 429) return true;
  const msg = extractMessage(err).toLowerCase();
  if (msg.includes("too many") || msg.includes("rate limit")) return true;
  return false;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSignUp(): UseSignUpReturn {
  const { client, afterSignUpUrl } = useKovaAuth();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const signUpEmail = useCallback(
    async (opts: SignUpEmailOpts) => {
      setLoading(true);
      setError(null);
      try {
        const res = await client.signUp.email({
          email: opts.email,
          password: opts.password,
          name: opts.name,
          // username is an optional plugin field — pass through if provided
          ...(opts.username ? { username: opts.username } : {}),
          callbackURL: opts.callbackURL ?? afterSignUpUrl,
        } as Parameters<typeof client.signUp.email>[0]);

        // Better Auth sets `requireEmailVerification` — the response body
        // won't contain a session token; it returns a redirect or empty body.
        const data = (res as unknown as { data?: { requiresEmailVerification?: boolean } })?.data;
        if (data?.requiresEmailVerification) {
          setVerificationPending(true);
        }

        // Clear any stale rate-limit on success
        setRetryAfterSeconds(null);
      } catch (err) {
        setError(extractMessage(err));
        if (is429(err)) {
          const secs = extractRetryAfter(err);
          setRetryAfterSeconds(secs);
        } else {
          setRetryAfterSeconds(null);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [client, afterSignUpUrl]
  );

  return {
    signUp: { email: signUpEmail },
    isLoading,
    error,
    clearError,
    verificationPending,
    retryAfterSeconds,
  };
}
