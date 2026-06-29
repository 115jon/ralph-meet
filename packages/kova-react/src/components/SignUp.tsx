/**
 * <SignUp /> — drop-in registration card.
 *
 * Renders an email + password form with optional username field.
 * After submission, the component transitions to a "check your email"
 * state when `requireEmailVerification` is enabled on the server.
 *
 * Social OAuth providers (if configured) appear above the form and share
 * the same redirect URI enforcement + error handling as <SignIn />.
 *
 * Rate limit feedback:
 *  When the server returns 429 Too Many Requests on sign-up, the form
 *  reads the `Retry-After` header and shows a `<RateLimitBanner>` with a
 *  live countdown, disabling the submit button until the window expires.
 *
 * @example
 * ```tsx
 * <SignUp
 *   afterSignUpUrl="/onboarding"
 *   signInUrl="/sign-in"
 * />
 * ```
 */

import { type FormEvent, useState } from "react";
import { mergeAppearance, useKovaAuth } from "../context";
import { useRateLimit } from "../hooks/use-rate-limit";
import { useSignUp } from "../hooks/use-sign-up";
import type { SignUpProps } from "../types";
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
} from "./ui";

// ── Password strength indicator ────────────────────────────────────────────────

const PASSWORD_RULES = [
  { label: "12+ characters", test: (p: string) => p.length >= 12 },
  { label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Number", test: (p: string) => /\d/.test(p) },
  { label: "Special character", test: (p: string) => /[^A-Za-z\d]/.test(p) },
];

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;
  const colors = ["#f87171", "#f97316", "#facc15", "#4ade80"];
  const color = colors[Math.max(0, passed - 1)] ?? "#f87171";

  return (
    <div
      style={{
        marginTop: -8,
        marginBottom: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Bar */}
      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: "var(--ra-color-border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${(passed / PASSWORD_RULES.length) * 100}%`,
            height: "100%",
            background: color,
            transition: "width 0.25s, background 0.25s",
            borderRadius: 2,
          }}
        />
      </div>
      {/* Rules */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "3px 12px",
        }}
      >
        {PASSWORD_RULES.map((r) => (
          <span
            key={r.label}
            style={{
              fontFamily: "var(--ra-font-mono)",
              fontSize: "0.75rem",
              color: r.test(password)
                ? "var(--ra-color-success)"
                : "var(--ra-color-text-tertiary)",
              transition: "color 0.15s",
            }}
          >
            {r.test(password) ? "✓" : "○"} {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SignUp({
  afterSignUpUrl,
  signInUrl = "/sign-in",
  appearance: instanceAppearance,
  className,
}: SignUpProps) {
  const {
    appearance: providerAppearance,
    afterSignUpUrl: providerUrl,
    oauthProviders,
    authUrl,
    isAppearanceLoaded,
  } = useKovaAuth();
  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};
  const resolvedUrl = afterSignUpUrl ?? providerUrl;

  const { signUp, isLoading, error, verificationPending, retryAfterSeconds } = useSignUp();

  // Rate-limit countdown — seeded by retryAfterSeconds from the hook
  const {
    isRateLimited,
    secondsRemaining,
    recordRateLimit,
  } = useRateLimit();

  // Seed countdown when retryAfterSeconds becomes non-null
  const [prevRetryAfter, setPrevRetryAfter] = useState<number | null>(null);
  if (retryAfterSeconds !== null && retryAfterSeconds !== prevRetryAfter) {
    setPrevRetryAfter(retryAfterSeconds);
    recordRateLimit(retryAfterSeconds);
  }

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const absCallbackUrl = resolveAbsoluteUrl(authUrl, resolvedUrl);

  if (!isAppearanceLoaded) {
    return (
      <Card elements={el} className={className}>
        <CardHeader
          title="Create an account"
          subtitle="Get started for free — no credit card required."
          elements={el}
        />
        <CardBody elements={el}>
          <div data-ra-element="socialButtonsRoot" style={el.socialButtonsRoot}>
            <Skeleton height={38} />
            <Skeleton height={38} />
            <Skeleton height={38} />
          </div>
          <Divider elements={el} />
          <Skeleton height={36} style={{ marginBottom: 14 }} />
          <Skeleton height={36} style={{ marginBottom: 14 }} />
          <Skeleton height={36} style={{ marginBottom: 14 }} />
          <Skeleton height={40} />
        </CardBody>
      </Card>
    );
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs["name"] = "Full name is required.";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs["email"] = "Enter a valid email address.";

    const allRules = PASSWORD_RULES.every((r) => r.test(password));
    if (!allRules)
      errs["password"] = "Password does not meet all requirements.";

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isRateLimited) return; // hard guard — button is also disabled
    if (!validate()) return;
    await signUp.email({ name, email, password, callbackURL: absCallbackUrl }).catch(() => null);
  };

  if (verificationPending) {
    return (
      <Card elements={el} className={className}>
        <CardHeader
          title="Check your email"
          subtitle={`We sent a verification link to ${email}. Click it to activate your account.`}
          elements={el}
        />
        <CardBody elements={el}>
          <Alert variant="info">
            Didn&apos;t get it? Check your spam folder, or{" "}
            <button
              type="button"
              onClick={() => void signUp.email({ name, email, password, callbackURL: absCallbackUrl })}
              style={{
                background: "none",
                border: "none",
                color: "var(--ra-color-primary)",
                cursor: "pointer",
                fontFamily: "var(--ra-font-mono)",
                fontSize: "inherit",
                padding: 0,
              }}
            >
              resend the email
            </button>
            .
          </Alert>
        </CardBody>
        <CardFooter elements={el}>
          <a href={signInUrl}>Back to sign in</a>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card elements={el} className={className}>
      <CardHeader
        title="Create an account"
        subtitle="Get started for free — no credit card required."
        elements={el}
      />

      <CardBody elements={el}>
        {oauthProviders.length > 0 && (
          <SocialButtons
            callbackURL={resolvedUrl}
            errorCallbackURL="/sign-up?error=oauth"
            elements={el}
          />
        )}

        {/* Divider between OAuth and form — only when both are present */}
        {oauthProviders.length > 0 && <Divider elements={el} />}

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          {error && !isRateLimited && <Alert variant="error">{error}</Alert>}
          {isRateLimited && (
            <RateLimitBanner
              secondsRemaining={secondsRemaining}
              totalSeconds={retryAfterSeconds ?? secondsRemaining}
            />
          )}

          <FormField
            id="ra-signup-name"
            label="Full name"
            type="text"
            value={name}
            onChange={setName}
            placeholder="Jane Smith"
            autoComplete="name"
            required
            disabled={isRateLimited}
            error={fieldErrors["name"]}
            elements={el}
          />
          <FormField
            id="ra-signup-email"
            label="Email address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            required
            disabled={isRateLimited}
            error={fieldErrors["email"]}
            elements={el}
          />
          <FormField
            id="ra-signup-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Min. 12 characters"
            autoComplete="new-password"
            required
            disabled={isRateLimited}
            error={fieldErrors["password"]}
            elements={el}
          />
          <PasswordStrength password={password} />

          <SubmitButton isLoading={isLoading} disabled={isRateLimited} elements={el}>
            Create account
          </SubmitButton>
        </form>
      </CardBody>

      <CardFooter elements={el}>
        <span style={{ color: "var(--ra-color-text-tertiary)" }}>
          Already have an account?{" "}
        </span>
        <a href={signInUrl}>Sign in</a>
      </CardFooter>
    </Card>
  );
}
