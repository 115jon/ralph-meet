/**
 * /activate — approve a desktop sign-in from the web app, Discord-style.
 *
 * Flow: a code arrives in the URL (or is typed), the signed-in user's app
 * session looks it up (which claims it), the review shows what the device
 * said about itself and where Kova saw the request come from, and Approve
 * or Deny settles it. Every outcome is announced via aria-live and focus
 * moves to the new heading. Copy mirrors Kova's hosted /device page so the
 * two read as one product.
 *
 * Signed-out visitors are sent to /sign-in with a path-only, same-origin
 * `redirect_url` back here (see activateReturnPath).
 *
 * "Not you?" releases this account's claim on the code (so the next account
 * can look it up), then signs out straight to that same sign-in URL. If the
 * release fails it still signs out, but lands on a "Code in use" page that
 * asks for a fresh code from the device (`?release=failed`).
 */

import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { markAuthLogoutIntent } from "@/lib/desktop-auth";
import {
  activateReturnPath,
  formatDeviceCode,
  initials,
  isCompleteDeviceCode,
  prettyPlatform,
  releaseFailedPath,
  spelledDeviceCode,
  switchAccountSignInUrl,
  waitPhrase,
} from "@/lib/device-code-format";
import { getKovaAuthUrl } from "@/lib/kova-auth-config";
import {
  useAuth,
  useDeviceApproval,
  useUser,
  type DeviceApprovalError,
  type DeviceRequest,
} from "@kova/react";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type Outcome =
  | "denied"
  | "expired"
  | "invalid"
  | "used"
  | "claimed"
  | "release_failed"
  | "rate_limited"
  | "mfa_required"
  | "network"
  | "unavailable";

type View =
  | { kind: "enter"; code: string; error?: string }
  | { kind: "loading"; code: string }
  | { kind: "review"; code: string; request: DeviceRequest }
  | { kind: "approved"; code: string; deviceName?: string }
  | {
      kind: "outcome";
      code: string;
      outcome: Outcome;
      retryAfterSeconds?: number;
    };

type Copy = {
  title: string;
  body: string;
  action?: "enter" | "retry" | "sign-in";
};

export const OUTCOME_COPY: Record<Outcome, Copy> = {
  denied: {
    title: "Sign-in denied",
    body: "Nothing was signed in. You can close this tab.",
  },
  expired: {
    title: "Code expired",
    body: "Codes only last a few minutes. Get a new one from your device, then enter it here.",
    action: "enter",
  },
  invalid: {
    title: "Code not recognized",
    body: "Check the code on your device and enter it again.",
    action: "enter",
  },
  used: {
    title: "Code already used",
    body: "This code was already approved or denied. Start sign-in again on your device for a new one.",
    action: "enter",
  },
  claimed: {
    title: "Code in use",
    body: "Another account is already reviewing this code. If that wasn't you, start sign-in again on your device.",
    action: "enter",
  },
  release_failed: {
    title: "Code in use",
    body: "We couldn't free this code from the account you signed out of, so another account can't use it. Start sign-in again on your device to get a new code.",
    action: "enter",
  },
  rate_limited: {
    title: "Too many attempts",
    body: "Wait a few minutes before trying this code again.",
    action: "retry",
  },
  mfa_required: {
    title: "Two-factor sign-in needed",
    body: "This account requires two-factor authentication before it can approve a device. Sign in again with your second factor, then enter the code.",
    action: "sign-in",
  },
  network: {
    title: "Couldn't reach the server",
    body: "Check your connection and try again.",
    action: "retry",
  },
  unavailable: {
    title: "Something went wrong",
    body: "We couldn't load this sign-in. It's not you. Try again in a moment.",
    action: "retry",
  },
};

/** Maps SDK error codes to a page outcome; `null` means "sign in again". */
export function outcomeForError(error: DeviceApprovalError): Outcome | null {
  switch (error.error) {
    case "invalid_code":
      return "invalid";
    case "expired_token":
      return "expired";
    case "already_processed":
      return "used";
    case "access_denied":
    case "not_claimed":
      return "claimed";
    case "rate_limited":
      return "rate_limited";
    case "mfa_required":
      return "mfa_required";
    case "network_error":
      return "network";
    case "invalid_session":
      return null;
    default:
      return "unavailable";
  }
}

export function deviceName(request: DeviceRequest): string | undefined {
  return (
    request.device.label?.trim() ||
    prettyPlatform(request.device.platform) ||
    request.device.hostname?.trim() ||
    undefined
  );
}

function uniqueParts(parts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

// ── Small pieces ──────────────────────────────────────────────────────────────

const BTN =
  "relative inline-flex h-11 w-full items-center justify-center gap-2.5 overflow-hidden rounded-[10px] px-4 text-ui-base font-medium leading-none text-[var(--rm-text-primary)] transition-[transform,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [-webkit-tap-highlight-color:transparent] after:pointer-events-none after:absolute after:inset-0 after:bg-current after:opacity-0 after:transition-opacity after:duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-accent)] disabled:cursor-default active:enabled:scale-[0.97] motion-reduce:active:enabled:scale-100 pointer-fine:hover:enabled:after:opacity-[0.07]";
const BTN_SECONDARY = `${BTN} border border-[var(--rm-border)] bg-[var(--rm-bg-hover)] pointer-fine:hover:enabled:border-[var(--rm-text-ghost)] disabled:opacity-50`;
const BTN_PRIMARY = `${BTN} bg-[var(--rm-accent)] font-semibold text-white disabled:opacity-50`;

function Button({
  variant = "secondary",
  busy,
  children,
  ...rest
}: {
  variant?: "primary" | "secondary";
  busy?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      className={`${variant === "primary" ? BTN_PRIMARY : BTN_SECONDARY} ${busy ? "[&>.label]:opacity-0" : ""}`}
    >
      <span className="label">{children}</span>
      {busy ? (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-white/35 border-t-white motion-reduce:animate-pulse"
        />
      ) : null}
    </button>
  );
}

function Heading({
  children,
  headingRef,
}: {
  children: ReactNode;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <h1
      ref={headingRef}
      tabIndex={-1}
      className="text-balance text-ui-2xl font-semibold leading-tight tracking-[-0.02em] outline-none [overflow-wrap:anywhere]"
    >
      {children}
    </h1>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-pretty text-ui-base text-[var(--rm-text-secondary)] [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

function Logo() {
  return (
    <ThemeAwareSplashLogo
      className="mb-[18px] block h-11 w-11 object-contain"
      data-testid="activate-logo"
    />
  );
}

function CheckIcon() {
  return (
    <svg
      className="mb-4 block h-12 w-12"
      viewBox="0 0 48 48"
      width="48"
      height="48"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="24"
        cy="24"
        r="22"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.14"
        strokeWidth="2"
      />
      <path
        d="M15 24.5l6 6 12-13"
        fill="none"
        stroke="var(--rm-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
        className="activate-check-path"
      />
    </svg>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

/** Everything the page needs from the SDK; overridable for stories and previews. */
export interface ActivationDeps {
  auth: Pick<ReturnType<typeof useAuth>, "isLoaded" | "isSignedIn" | "signOut">;
  user: ReturnType<typeof useUser>["user"];
  approval: ReturnType<typeof useDeviceApproval>;
}

export function DeviceActivation({
  initialCode,
  releaseFailed = false,
  deps,
}: {
  initialCode?: string;
  /** Landed here from a "Not you?" whose release failed (`?release=failed`). */
  releaseFailed?: boolean;
  deps?: ActivationDeps;
}) {
  const navigate = useNavigate();
  const realAuth = useAuth();
  const realUser = useUser();
  const realApproval = useDeviceApproval();
  const { isLoaded, isSignedIn, signOut } = deps?.auth ?? realAuth;
  const user = deps ? deps.user : realUser.user;
  const {
    isReady,
    getDeviceRequest,
    approveDeviceRequest,
    denyDeviceRequest,
    releaseDeviceRequest,
  } = deps?.approval ?? realApproval;
  const formatted = formatDeviceCode(initialCode);
  const complete = isCompleteDeviceCode(formatted);

  const [view, setView] = useState<View>(() =>
    releaseFailed
      ? { kind: "outcome", code: formatted, outcome: "release_failed" }
      : complete
        ? { kind: "loading", code: formatted }
        : {
            kind: "enter",
            code: formatted,
            error: initialCode && !complete ? "format" : undefined,
          },
  );
  // The failed-release page is shown signed out; everything else needs a session.
  const showsSignedOut =
    view.kind === "outcome" && view.outcome === "release_failed";
  const [busy, setBusy] = useState<"approve" | "deny" | "switch" | null>(null);
  const [inlineError, setInlineError] = useState("");
  const [lookupNonce, setLookupNonce] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusId = useId();
  const [status, setStatus] = useState("");

  const returnPath = activateReturnPath(view.code);

  const goSignIn = useCallback(() => {
    void navigate({
      to: "/sign-in",
      search: { redirect_url: returnPath } as never,
      replace: true,
    });
  }, [navigate, returnPath]);

  // Signed out → sign in and come back here. Not while "Not you?" is
  // switching: it picks the destination itself once the release settles.
  const switching = busy === "switch";
  useEffect(() => {
    if (isLoaded && !isSignedIn && !showsSignedOut && !switching) goSignIn();
  }, [isLoaded, isSignedIn, showsSignedOut, switching, goSignIn]);

  // Look the code up (and claim it) once the session is usable.
  useEffect(() => {
    if (view.kind !== "loading" || !isReady || !isSignedIn) return;
    let cancelled = false;
    void getDeviceRequest(view.code).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        if (result.request.status === "pending") {
          setView({ kind: "review", code: view.code, request: result.request });
        } else {
          setView({ kind: "outcome", code: view.code, outcome: "used" });
        }
        return;
      }
      const outcome = outcomeForError(result);
      if (outcome === null) {
        goSignIn();
        return;
      }
      setView({
        kind: "outcome",
        code: view.code,
        outcome,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    view.kind,
    view.code,
    isReady,
    isSignedIn,
    getDeviceRequest,
    goSignIn,
    lookupNonce,
  ]);

  // Move focus to the heading whenever the stage changes.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [view.kind, view.kind === "outcome" ? view.outcome : null]);

  async function decide(action: "approve" | "deny", request: DeviceRequest) {
    if (busy) return;
    setBusy(action);
    setInlineError("");
    const result =
      action === "approve"
        ? await approveDeviceRequest(request.userCode)
        : await denyDeviceRequest(request.userCode);
    if (result.ok) {
      if (result.status === "approved") {
        const name = deviceName(request);
        setView({ kind: "approved", code: request.userCode, deviceName: name });
        setStatus(
          `${name ? `You're signed in on ${name}` : "You're signed in"}. You can close this tab and go back to the app.`,
        );
      } else {
        setView({ kind: "outcome", code: request.userCode, outcome: "denied" });
        setStatus(`${OUTCOME_COPY.denied.title}. ${OUTCOME_COPY.denied.body}`);
      }
      setBusy(null);
      return;
    }
    const outcome = outcomeForError(result);
    if (outcome === null) {
      setInlineError("Your session ended. Reload the page to sign in again.");
    } else if (outcome === "network" || outcome === "unavailable") {
      setInlineError(
        outcome === "network"
          ? "Couldn't reach the server. Check your connection and try again."
          : "That didn't go through. Try again.",
      );
    } else {
      setView({
        kind: "outcome",
        code: request.userCode,
        outcome,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      setStatus(
        `${OUTCOME_COPY[outcome].title}. ${OUTCOME_COPY[outcome].body}`,
      );
    }
    setBusy(null);
  }

  async function switchAccount() {
    if (busy) return;
    setBusy("switch");
    const code = view.code;
    // Only a reviewed code is claimed by this account. Release it with the
    // current session, before signing out, so the next account can claim it.
    const released = view.kind === "review" ? await releaseClaim(code) : true;
    const target = released
      ? switchAccountSignInUrl(code)
      : releaseFailedPath(code);
    markAuthLogoutIntent();
    // The SDK hard-navigates to this URL once signed out. Passing it here is
    // what keeps its afterSignOutUrl ("/sign-in", no query) from winning.
    await signOut(target).catch(() => {});
    // Normally the page is already unloading; this covers a signOut that
    // didn't navigate.
    if (released) {
      goSignIn();
      return;
    }
    setView({ kind: "outcome", code, outcome: "release_failed" });
    setStatus(
      `${OUTCOME_COPY.release_failed.title}. ${OUTCOME_COPY.release_failed.body}`,
    );
    setBusy(null);
    void navigate({
      to: "/activate",
      search: { code, release: "failed" } as never,
      replace: true,
    });
  }

  /** Best effort; `not_claimed` means there was nothing to release. */
  async function releaseClaim(code: string): Promise<boolean> {
    try {
      const result = await releaseDeviceRequest(code);
      return result.ok || result.error === "not_claimed";
    } catch {
      return false;
    }
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = formatDeviceCode(
      new FormData(event.currentTarget).get("code"),
    );
    if (!isCompleteDeviceCode(code)) {
      setView({ kind: "enter", code, error: code ? "short" : "empty" });
      return;
    }
    void navigate({
      to: "/activate",
      search: { code } as never,
      replace: true,
    });
    setView({ kind: "loading", code });
    setLookupNonce((n) => n + 1);
  }

  if (!showsSignedOut && (!isLoaded || !isSignedIn)) return null;

  const live = (
    <p className="sr-only" id={statusId} role="status" aria-live="polite">
      {status}
    </p>
  );

  if (view.kind === "enter") {
    const message =
      view.error === "format"
        ? "Codes are 8 letters and numbers, like ABCD-EFGH. Check the code and try again."
        : view.error === "short"
          ? "That code is too short. Codes are 8 letters and numbers, like ABCD-EFGH."
          : view.error === "empty"
            ? "Enter the code shown on your device."
            : "";
    return (
      <div className="auth-enter">
        <Logo />
        <Heading headingRef={headingRef}>Connect a device</Heading>
        <Sub>Enter the code shown on your device to sign in to Ralph Meet.</Sub>
        <form
          className="mt-[18px] flex flex-col gap-2"
          onSubmit={submitCode}
          noValidate
        >
          <label htmlFor="device-code" className="sr-only">
            Device code
          </label>
          <input
            id="device-code"
            name="code"
            type="text"
            defaultValue={view.code}
            placeholder="XXXX-XXXX"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={24}
            required
            autoFocus
            aria-describedby="code-error"
            aria-invalid={message ? true : undefined}
            onChange={(e) => {
              const next = formatDeviceCode(e.target.value);
              if (next !== e.target.value) e.target.value = next;
            }}
            className="h-11 w-full rounded-[10px] border border-[var(--rm-border)] bg-[var(--rm-bg-hover)] px-3 text-center font-mono text-ui-xl font-medium uppercase tracking-[0.12em] text-[var(--rm-text-primary)] tabular-nums outline-none transition-[border-color,box-shadow] duration-150 placeholder:tracking-[0.12em] placeholder:text-[var(--rm-text-muted)] focus:border-[var(--rm-accent)] focus:shadow-[0_0_0_3px_var(--rm-accent-dim)] aria-[invalid=true]:border-[var(--rm-status-dnd)]/70"
          />
          <p
            id="code-error"
            role="alert"
            className="text-ui-sm text-[var(--rm-status-dnd)] empty:hidden"
          >
            {message}
          </p>
          <Button variant="primary" type="submit">
            Continue
          </Button>
        </form>
        {live}
      </div>
    );
  }

  if (view.kind === "loading") {
    return (
      <div className="auth-enter">
        <Logo />
        <Heading headingRef={headingRef}>Checking your code</Heading>
        <Sub>
          <span className="font-mono tabular-nums">{view.code}</span>
        </Sub>
        <div className="mt-[18px] h-11 animate-pulse rounded-[10px] bg-[var(--rm-bg-hover)]" />
        {live}
      </div>
    );
  }

  if (view.kind === "review") {
    const { request } = view;
    const main = uniqueParts([
      request.device.label,
      prettyPlatform(request.device.platform),
    ]);
    const host = request.device.hostname?.trim();
    const hostname =
      host && !main.some((p) => p.toLowerCase() === host.toLowerCase())
        ? host
        : undefined;
    const devicePrimary = main.join(" · ") || host || "";
    const place = uniqueParts([
      request.requester.city,
      request.requester.country,
    ]).join(", ");
    const ip = request.requester.ip?.trim();
    const name = user?.name?.trim() || "";
    const email = user?.email ?? "";
    const displayName = name || email;
    return (
      <div className="auth-enter">
        <Logo />
        <Heading headingRef={headingRef}>Sign in to Ralph Meet?</Heading>
        <Sub>Make sure this matches the code on your device.</Sub>
        <p className="mt-[18px] rounded-[10px] border border-[var(--rm-border)] bg-[var(--rm-bg-secondary)] p-3 text-center font-mono text-ui-2xl font-medium leading-tight tracking-[0.08em] tabular-nums">
          <span aria-hidden="true">{request.userCode}</span>
          <span className="sr-only">
            Code: {spelledDeviceCode(request.userCode)}
          </span>
        </p>
        {devicePrimary || place || ip ? (
          <dl className="mt-3.5 text-ui-sm">
            {devicePrimary ? (
              <div className="grid grid-cols-1 gap-0.5 border-t border-[var(--rm-border)] py-2.5 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3">
                <dt className="text-[var(--rm-text-muted)]">Device</dt>
                <dd className="min-w-0 text-[var(--rm-text-secondary)] [overflow-wrap:anywhere]">
                  {devicePrimary}
                  {hostname ? (
                    <span className="block text-ui-sm text-[var(--rm-text-muted)]">
                      {hostname}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-ui-xs italic text-[var(--rm-text-muted)]">
                    Reported by the device
                  </span>
                </dd>
              </div>
            ) : null}
            {place || ip ? (
              <div className="grid grid-cols-1 gap-0.5 border-y border-[var(--rm-border)] py-2.5 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3">
                <dt className="text-[var(--rm-text-muted)]">Requested from</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">
                  {place || ip}
                  {place && ip ? (
                    <span
                      className="block truncate text-ui-sm text-[var(--rm-text-muted)] tabular-nums"
                      title={ip}
                    >
                      {ip}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div className="mt-3.5 flex items-center gap-3 rounded-[10px] border border-[var(--rm-border)] bg-[var(--rm-bg-hover)] px-3 py-2.5">
          <span
            aria-hidden="true"
            className="relative grid h-9 w-9 flex-none place-items-center overflow-hidden rounded-full bg-[var(--rm-bg-active)] text-ui-sm font-semibold"
          >
            {initials(name, email)}
            {user?.image ? (
              <img
                src={user.image}
                alt=""
                width={36}
                height={36}
                decoding="async"
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => e.currentTarget.remove()}
              />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-snug">
            <span className="truncate font-medium">{displayName}</span>
            {name ? (
              <span className="truncate text-ui-sm text-[var(--rm-text-muted)]">
                {email}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={switchAccount}
            disabled={busy !== null}
            className="-mr-1 min-h-11 flex-none rounded-lg px-1 text-ui-sm text-[var(--rm-text-secondary)] underline decoration-[var(--rm-accent)]/60 underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-accent)] disabled:opacity-50 pointer-fine:hover:text-[var(--rm-text-primary)]"
          >
            Not you?<span className="sr-only"> Use another account</span>
          </button>
        </div>
        <div className="mt-[18px] grid grid-cols-2 gap-2">
          <Button
            onClick={() => decide("deny", request)}
            disabled={busy !== null}
            busy={busy === "deny"}
            id="deny-device"
          >
            Deny
          </Button>
          <Button
            variant="primary"
            onClick={() => decide("approve", request)}
            disabled={busy !== null}
            busy={busy === "approve"}
            id="approve-device"
          >
            Approve
          </Button>
        </div>
        <p
          role="alert"
          className="mt-3 text-ui-sm text-[var(--rm-status-dnd)] empty:hidden"
        >
          {inlineError}
        </p>
        <p className="mt-3.5 text-pretty text-ui-sm text-[var(--rm-text-muted)]">
          Only approve if you started this sign-in yourself.
        </p>
        {live}
      </div>
    );
  }

  if (view.kind === "approved") {
    return (
      <div className="auth-enter">
        <CheckIcon />
        <Heading headingRef={headingRef}>
          {view.deviceName
            ? `You're signed in on ${view.deviceName}`
            : "You're signed in"}
        </Heading>
        <Sub>You can close this tab and go back to the app.</Sub>
        {live}
      </div>
    );
  }

  const copy = OUTCOME_COPY[view.outcome];
  const wait =
    view.outcome === "rate_limited"
      ? waitPhrase(view.retryAfterSeconds)
      : undefined;
  const body = wait ? `Wait ${wait} before trying this code again.` : copy.body;
  return (
    <div className="auth-enter">
      <Logo />
      <Heading headingRef={headingRef}>{copy.title}</Heading>
      <Sub>{body}</Sub>
      {copy.action === "enter" ? (
        <a
          href="/activate"
          className={`${BTN_SECONDARY} mt-[18px] no-underline pointer-fine:hover:no-underline`}
        >
          Enter a different code
        </a>
      ) : copy.action === "retry" ? (
        <div className="mt-[18px]">
          <Button
            onClick={() => {
              setView({ kind: "loading", code: view.code });
              setLookupNonce((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : copy.action === "sign-in" ? (
        <div className="mt-[18px] flex flex-col gap-3">
          <Button
            onClick={switchAccount}
            disabled={busy !== null}
            busy={busy === "switch"}
          >
            Sign in again
          </Button>
          <p className="text-ui-sm text-[var(--rm-text-muted)]">
            Manage two-factor in your{" "}
            <a
              href={`${getKovaAuthUrl()}/settings`}
              className="text-[var(--rm-text-secondary)] underline underline-offset-[3px]"
            >
              account security settings
            </a>
            .
          </p>
        </div>
      ) : null}
      {live}
    </div>
  );
}
