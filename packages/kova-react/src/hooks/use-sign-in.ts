/**
 * useSignIn — imperative sign-in actions.
 *
 * Provides typed methods for every auth flow: email/password, magic link,
 * OAuth redirect, passkey, and TOTP verification. Tracks loading / error
 * state per-action so you can build a completely custom sign-in UI.
 *
 * Now includes rate-limit awareness: when the server returns 429, the hook
 * parses the `Retry-After` response header and exposes `retryAfterSeconds`
 * in the return value so callers can present an accurate countdown to the user.
 *
 * @example
 * ```tsx
 * const { signIn, isLoading, error, retryAfterSeconds } = useSignIn();
 *
 * async function handleSubmit(e: FormEvent) {
 *   e.preventDefault();
 *   await signIn.email({ email, password });
 * }
 * ```
 */

import { useCallback, useState } from "react";
import { useKovaAuth } from "../context";
import { extractRetryAfter } from "./use-rate-limit";

interface SignInEmailOpts {
  email: string;
  password: string;
  rememberMe?: boolean;
  /** Override the URL to redirect. Inherits from provider if omitted. */
  callbackURL?: string;
}

interface SignInMagicLinkOpts {
  email: string;
  callbackURL?: string;
}

interface SignInSocialOpts {
  provider: string;
  callbackURL?: string;
  errorCallbackURL?: string;
}

interface SignInPasskeyOpts {
  callbackURL?: string;
}

interface SignInTOTPOpts {
  code: string;
}

interface SignInEmailOtpVerifyOpts {
  email: string;
  otp: string;
}

export interface UseSignInReturn {
  signIn: {
    /**
     * Sign in with email + password.
     * Returns `{ twoFactorRequired: true }` if 2FA is pending.
     */
    email: (opts: SignInEmailOpts) => Promise<{ twoFactorRequired?: boolean }>;
    /** Send a magic link email — user clicks it to sign in. */
    magicLink: (opts: SignInMagicLinkOpts) => Promise<void>;
    /** Redirect to an OAuth provider's consent page. */
    social: (opts: SignInSocialOpts) => Promise<void>;
    /** Authenticate with a registered WebAuthn passkey. */
    passkey: (opts?: SignInPasskeyOpts) => Promise<void>;
    /** Submit a TOTP code for pending 2FA challenge. */
    totp: (opts: SignInTOTPOpts) => Promise<void>;
    /** Verify an email OTP for pending 2FA challenge. */
    emailOtp: (opts: SignInEmailOtpVerifyOpts) => Promise<void>;
  };
  /** `true` while any sign-in action is in flight. */
  isLoading: boolean;
  /** Last error message from a failed sign-in attempt. `null` if none. */
  error: string | null;
  /** Clears the current error. */
  clearError: () => void;
  /**
   * Present when email/password sign-in succeeds but the server requires a
   * 2FA step before granting a full session.
   */
  twoFactorRequired: boolean;
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

/** Extracts a human-readable message from any error shape returned by Better Auth. */
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

/**
 * Returns `true` if the error represents an HTTP 429 Too Many Requests.
 * Better Auth surfaces 429 via the error.status field in the onError callback,
 * and also throws errors with a .status property in some paths.
 */
function is429(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const a = err as Record<string, unknown>;
  if (a["status"] === 429) return true;
  const inner = a["error"] as Record<string, unknown> | undefined;
  if (inner?.["status"] === 429) return true;
  // Better Auth also sets the message to "Too many requests" on rate limit
  const msg = extractMessage(err).toLowerCase();
  if (msg.includes("too many") || msg.includes("rate limit")) return true;
  return false;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSignIn(): UseSignInReturn {
  const { client, afterSignInUrl } = useKovaAuth();
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(extractMessage(err));
        // Surface Retry-After for all rate-limited actions
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
    []
  );

  const signInEmail = useCallback(
    async (opts: SignInEmailOpts) => {
      return run(async () => {
        const res = await client.signIn.email({
          email: opts.email,
          password: opts.password,
          rememberMe: opts.rememberMe ?? true,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
          fetchOptions: {
            onSuccess() {
              setTwoFactorRequired(false);
              setRetryAfterSeconds(null);
            },
            onError(ctx: {
              error: { message?: string; status?: number };
              response?: Response;
            }) {
              const msg = ctx.error.message ?? "";
              // Better Auth returns this specific message for pending 2FA
              if (
                msg.toLowerCase().includes("two factor") ||
                ctx.error.status === 403
              ) {
                setTwoFactorRequired(true);
              }
              // Surface Retry-After via the onError callback's response object
              if (ctx.error.status === 429 && ctx.response) {
                const secs = extractRetryAfter({ response: ctx.response });
                if (secs !== null) setRetryAfterSeconds(secs);
              }
            },
          },
        });
        // Check if the response body signals 2FA is required
        const body = (res as unknown as { data?: { twoFactorRedirect?: boolean } })?.data;
        if (body?.twoFactorRedirect) {
          setTwoFactorRequired(true);
          return { twoFactorRequired: true };
        }
        return {};
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInMagicLink = useCallback(
    async (opts: SignInMagicLinkOpts) => {
      await run(async () => {
        await (client as unknown as {
          signIn: { magicLink: (o: { email: string; callbackURL: string }) => Promise<unknown> };
        }).signIn.magicLink({
          email: opts.email,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
        });
        // Clear any stale rate-limit state on success
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInSocial = useCallback(
    async (opts: SignInSocialOpts) => {
      await run(async () => {
        await client.signIn.social({
          provider: opts.provider,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
          errorCallbackURL: opts.errorCallbackURL,
        } as Parameters<typeof client.signIn.social>[0]);
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInPasskey = useCallback(
    async (opts: SignInPasskeyOpts = {}) => {
      await run(async () => {
        await (client as unknown as {
          signIn: {
            passkey: (o: { callbackURL: string }) => Promise<unknown>;
          };
        }).signIn.passkey({
          callbackURL: opts.callbackURL ?? afterSignInUrl,
        });
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInTotp = useCallback(
    async (opts: SignInTOTPOpts) => {
      await run(async () => {
        await (client as unknown as {
          twoFactor: {
            verifyTotp: (o: {
              code: string;
              callbackURL: string;
            }) => Promise<unknown>;
          };
        }).twoFactor.verifyTotp({
          code: opts.code,
          callbackURL: afterSignInUrl,
        });
        setTwoFactorRequired(false);
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );

  const signInEmailOtp = useCallback(
    async (opts: SignInEmailOtpVerifyOpts) => {
      await run(async () => {
        await (client as unknown as {
          twoFactor: {
            verifyOtp: (o: { code: string }) => Promise<unknown>;
          };
        }).twoFactor.verifyOtp({ code: opts.otp });
        setTwoFactorRequired(false);
        setRetryAfterSeconds(null);
      });
    },
    [client, run]
  );

  return {
    signIn: {
      email: signInEmail,
      magicLink: signInMagicLink,
      social: signInSocial,
      passkey: signInPasskey,
      totp: signInTotp,
      emailOtp: signInEmailOtp,
    },
    isLoading,
    error,
    clearError,
    twoFactorRequired,
    retryAfterSeconds,
  };
}
