/**
 * <SignIn /> — drop-in, fully themeable sign-in card.
 *
 * Supports every auth method enabled on your kova-auth server:
 *  - Email + Password (with optional "remember me")
 *  - Magic Link (passwordless)
 *  - OAuth social providers (Google, Discord, etc.)
 *  - WebAuthn Passkey
 *  - TOTP / Email OTP two-factor challenge
 *
 * All methods are shown by default. Tabs are rendered only for methods
 * that require a form (email, magic-link); OAuth + passkey are always visible.
 *
 * Rate limit feedback:
 *  When the server returns 429 Too Many Requests, each form variant reads
 *  the `Retry-After` header (exposed via the `retryAfterSeconds` hook value),
 *  starts a live countdown, disables the submit button, and renders a
 *  `<RateLimitBanner>` with an animated progress bar.
 *
 * @example
 * ```tsx
 * <SignIn
 *   afterSignInUrl="/dashboard"
 *   signUpUrl="/sign-up"
 *   appearance={{ variables: { colorPrimary: "#7c3aed" } }}
 * />
 * ```
 */

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  mergeAppearance,
  useKovaAuth,
} from "../context";
import { useRateLimit } from "../hooks/use-rate-limit";
import { useSignIn } from "../hooks/use-sign-in";
import type { Appearance, AppearanceElements, SignInProps, SignInTab } from "../types";
import { FingerprintIcon, MailIcon } from "./icons";
import { resolveAbsoluteUrl, SocialButtons } from "./social-buttons";
import {
  Alert,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Divider,
  FormField,
  RateLimitBanner,
  Skeleton,
  SubmitButton,
  Tabs,
} from "./ui";

// ── Sub-components ─────────────────────────────────────────────────────────────

function PasskeyButton({
  elements,
  callbackURL,
}: {
  elements?: AppearanceElements;
  callbackURL?: string;
}) {
  const { client, authUrl } = useKovaAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasskey = async () => {
    setLoading(true);
    setError(null);
    try {
      await (client as unknown as {
        signIn: { passkey: (o: { callbackURL: string }) => Promise<unknown> };
      }).signIn.passkey({ callbackURL: resolveAbsoluteUrl(authUrl, callbackURL) });
    } catch (err) {
      // Ignore user-cancel (DOMException name = "NotAllowedError")
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      setError("Passkey authentication failed. Try another method.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && <Alert variant="error">{error}</Alert>}
      <button
        type="button"
        data-ra-element="socialButton"
        style={elements?.socialButton}
        disabled={loading}
        onClick={() => void handlePasskey()}
      >
        <FingerprintIcon size={18} />
        {loading ? "Authenticating…" : "Sign in with passkey"}
      </button>
    </>
  );
}

function useSeedRateLimitCountdown(
  retryAfterSeconds: number | null,
  recordRateLimit: (retryAfterSeconds: number) => void,
) {
  const prevRetryAfterRef = useRef<number | null>(null);

  useEffect(() => {
    if (retryAfterSeconds === null) {
      prevRetryAfterRef.current = null;
      return;
    }

    if (retryAfterSeconds === prevRetryAfterRef.current) {
      return;
    }

    prevRetryAfterRef.current = retryAfterSeconds;
    recordRateLimit(retryAfterSeconds);
  }, [recordRateLimit, retryAfterSeconds]);
}

function EmailPasswordForm({
  afterSignInUrl,
  elements,
}: {
  afterSignInUrl: string;
  elements?: AppearanceElements;
}) {
  const { signIn, isLoading, error, twoFactorRequired, retryAfterSeconds } = useSignIn();
  const { authUrl } = useKovaAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Rate-limit countdown — seeded by retryAfterSeconds from the hook
  const {
    isRateLimited,
    secondsRemaining,
    recordRateLimit,
  } = useRateLimit();
  useSeedRateLimitCountdown(retryAfterSeconds, recordRateLimit);

  const absCallbackUrl = resolveAbsoluteUrl(authUrl, afterSignInUrl);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!email.trim()) errs["email"] = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs["email"] = "Enter a valid email address.";
    if (!password) errs["password"] = "Password is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isRateLimited) return; // hard guard — button is also disabled
    if (twoFactorRequired) {
      await signIn.totp({ code: totp }).catch(() => null);
      return;
    }
    if (!validate()) return;
    await signIn.email({ email, password, callbackURL: absCallbackUrl }).catch(() => null);
  };

  if (twoFactorRequired) {
    return (
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <Alert variant="info">
          Two-factor authentication required. Enter your 6-digit code.
        </Alert>
        {error && <Alert variant="error">{error}</Alert>}
        {isRateLimited && (
          <RateLimitBanner
            secondsRemaining={secondsRemaining}
            totalSeconds={retryAfterSeconds ?? secondsRemaining}
          />
        )}
        <FormField
          id="ra-totp"
          label="Authenticator Code"
          type="text"
          value={totp}
          onChange={setTotp}
          placeholder="000000"
          autoComplete="one-time-code"
          required
          disabled={isRateLimited}
          elements={elements}
        />
        <SubmitButton isLoading={isLoading} disabled={isRateLimited} elements={elements}>
          Verify Code
        </SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      {error && !isRateLimited && <Alert variant="error">{error}</Alert>}
      {isRateLimited && (
        <RateLimitBanner
          secondsRemaining={secondsRemaining}
          totalSeconds={retryAfterSeconds ?? secondsRemaining}
        />
      )}
      <FormField
        id="ra-email"
        label="Email address"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        required
        disabled={isRateLimited}
        error={fieldErrors["email"]}
        elements={elements}
      />
      <FormField
        id="ra-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder="••••••••••••"
        autoComplete="current-password"
        required
        disabled={isRateLimited}
        error={fieldErrors["password"]}
        elements={elements}
      />
      <SubmitButton isLoading={isLoading} disabled={isRateLimited} elements={elements}>
        Continue
      </SubmitButton>
    </form>
  );
}

function MagicLinkForm({
  afterSignInUrl,
  elements,
}: {
  afterSignInUrl: string;
  elements?: AppearanceElements;
}) {
  const { signIn, isLoading, error, retryAfterSeconds } = useSignIn();
  const { authUrl } = useKovaAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Rate-limit countdown
  const {
    isRateLimited,
    secondsRemaining,
    recordRateLimit,
  } = useRateLimit();
  useSeedRateLimitCountdown(retryAfterSeconds, recordRateLimit);

  const absCallbackUrl = resolveAbsoluteUrl(authUrl, afterSignInUrl);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isRateLimited) return;
    setFieldError(null);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    try {
      await signIn.magicLink({ email, callbackURL: absCallbackUrl });
      setSent(true);
    } catch {
      // error is surfaced via the hook
    }
  };

  if (sent) {
    return (
      <Alert variant="success">
        ✉️ Magic link sent! Check your email and click the link to sign in.
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      {error && !isRateLimited && <Alert variant="error">{error}</Alert>}
      {isRateLimited && (
        <RateLimitBanner
          secondsRemaining={secondsRemaining}
          totalSeconds={retryAfterSeconds ?? secondsRemaining}
        />
      )}
      <FormField
        id="ra-magic-email"
        label="Email address"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        required
        disabled={isRateLimited}
        error={fieldError}
        elements={elements}
      />
      <SubmitButton isLoading={isLoading} disabled={isRateLimited} elements={elements}>
        <MailIcon size={15} />
        Send sign-in link
      </SubmitButton>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const TABS: Array<{ id: SignInTab; label: string }> = [
  { id: "email", label: "Password" },
  { id: "magic-link", label: "Magic Link" },
  { id: "passkey", label: "Passkey" },
];

export function SignIn({
  afterSignInUrl,
  signUpUrl = "/sign-up",
  defaultTab = "email",
  appearance: instanceAppearance,
  className,
}: SignInProps) {
  const { appearance: providerAppearance, afterSignInUrl: providerAfterSignIn, oauthProviders, isAppearanceLoaded } =
    useKovaAuth();

  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};
  const resolvedUrl = afterSignInUrl ?? providerAfterSignIn;

  const [activeTab, setActiveTab] = useState<SignInTab>(defaultTab);

  if (!isAppearanceLoaded) {
    return (
      <Card elements={el} className={className}>
        <CardHeader title="Sign in" subtitle="Welcome back. Choose your sign-in method." elements={el} />
        <CardBody elements={el}>
          <div data-ra-element="socialButtonsRoot" style={el.socialButtonsRoot}>
            <Skeleton height={38} />
            <Skeleton height={38} />
            <Skeleton height={38} />
          </div>
          <Divider elements={el} />
          <Skeleton height={42} style={{ marginBottom: 20 }} />
          <Skeleton height={36} style={{ marginBottom: 14 }} />
          <Skeleton height={36} style={{ marginBottom: 14 }} />
          <Skeleton height={40} />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card elements={el} className={className}>
      <CardHeader
        title="Sign in"
        subtitle="Welcome back. Choose your sign-in method."
        elements={el}
      />

      <CardBody elements={el}>
        {/* OAuth social providers */}
        {oauthProviders.length > 0 && (
          <>
            <SocialButtons
              elements={el}
              callbackURL={resolvedUrl}
              errorCallbackURL="/sign-in?error=oauth"
            />
            <Divider elements={el} />
          </>
        )}

        {/* Method tabs (email | magic-link | passkey) */}
        <Tabs
          tabs={TABS}
          active={activeTab}
          onSelect={(id) => setActiveTab(id as SignInTab)}
          elements={el}
        />

        {activeTab === "email" && (
          <EmailPasswordForm afterSignInUrl={resolvedUrl} elements={el} />
        )}
        {activeTab === "magic-link" && (
          <MagicLinkForm afterSignInUrl={resolvedUrl} elements={el} />
        )}
        {activeTab === "passkey" && (
          <PasskeyButton elements={el} callbackURL={resolvedUrl} />
        )}
      </CardBody>

      <CardFooter elements={el}>
        <span style={{ color: "var(--ra-color-text-tertiary)" }}>
          Don&apos;t have an account?{" "}
        </span>
        <a href={signUpUrl}>Sign up</a>
      </CardFooter>
    </Card>
  );
}

// Re-export appearance type for convenience
export type { Appearance };
