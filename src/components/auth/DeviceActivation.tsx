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
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { HIT } from "@/components/ui/interaction";
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
      className="text-balance text-ui-xl font-semibold text-rm-text outline-none [overflow-wrap:anywhere]"
    >
      {children}
    </h1>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-pretty text-ui-base text-rm-text-secondary [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

/** 14.3 inline error strip; empty renders nothing but keeps the live region. */
function ErrorStrip({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="mt-3 empty:hidden">
      {children ? (
        <p className="flex items-start gap-2 rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm text-rm-danger-ink">
          <Icon name="alert" size="sm" className="mt-px shrink-0" />
          <span className="min-w-0 text-pretty">{children}</span>
        </p>
      ) : null}
    </div>
  );
}

function Logo() {
  return (
    <ThemeAwareSplashLogo
      className="mb-4 block size-11 object-contain"
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
        stroke="var(--rm-accent-ink)"
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
  const codeInputId = useId();
  const codeErrorId = useId();
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
    if (view.kind !== "loading" || !isReady || !isLoaded || !isSignedIn) {
      return;
    }
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
    isLoaded,
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

  const live = (
    <p className="sr-only" id={statusId} role="status" aria-live="polite">
      {status}
    </p>
  );

  // Auth still loading, or signed out and about to be sent to sign-in: show
  // the loading view instead of an empty column.
  if (!showsSignedOut && (!isLoaded || !isSignedIn)) {
    return (
      <LoadingView
        headingRef={headingRef}
        code={complete ? formatted : undefined}
      />
    );
  }

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
          className="mt-6 flex flex-col gap-2"
          onSubmit={submitCode}
          noValidate
        >
          <label htmlFor={codeInputId} className="sr-only">
            Device code
          </label>
          <Input
            id={codeInputId}
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
            aria-describedby={codeErrorId}
            aria-invalid={message ? true : undefined}
            onChange={(e) => {
              const next = formatDeviceCode(e.target.value);
              if (next !== e.target.value) e.target.value = next;
            }}
            className="h-11 text-center font-mono text-ui-xl font-medium uppercase tracking-[0.12em] tabular-nums placeholder:tracking-[0.12em] md:text-ui-xl"
          />
          <p
            id={codeErrorId}
            role="alert"
            className="text-ui-xs text-rm-danger-ink empty:hidden"
          >
            {message}
          </p>
          <Button type="submit" size="lg" className="mt-2 w-full">
            Continue
          </Button>
        </form>
        {live}
      </div>
    );
  }

  if (view.kind === "loading") {
    return (
      <>
        <LoadingView headingRef={headingRef} code={view.code} />
        {live}
      </>
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
        <p className="mt-6 rounded-lg border border-rm-border bg-rm-bg-surface p-3 text-center font-mono text-ui-2xl font-medium tracking-[0.08em] text-rm-text tabular-nums">
          <span aria-hidden="true">{request.userCode}</span>
          <span className="sr-only">
            Code: {spelledDeviceCode(request.userCode)}
          </span>
        </p>
        {devicePrimary || place || ip ? (
          <dl className="mt-4 text-ui-sm">
            {devicePrimary ? (
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-rm-border py-2.5">
                <dt className="text-rm-text-muted">Device</dt>
                <dd className="min-w-0 text-rm-text-secondary [overflow-wrap:anywhere]">
                  {devicePrimary}
                  {hostname ? (
                    <span className="block text-rm-text-muted">{hostname}</span>
                  ) : null}
                  <span className="mt-0.5 block text-ui-xs text-rm-text-muted">
                    Reported by the device
                  </span>
                </dd>
              </div>
            ) : null}
            {place || ip ? (
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-y border-rm-border py-2.5">
                <dt className="text-rm-text-muted">Requested from</dt>
                <dd className="min-w-0 text-rm-text [overflow-wrap:anywhere]">
                  {place || ip}
                  {place && ip ? (
                    <span
                      className="block truncate text-rm-text-muted tabular-nums"
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
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-rm-tint-1 px-3 py-2.5">
          <span
            aria-hidden="true"
            className="relative grid size-9 flex-none place-items-center overflow-hidden rounded-full bg-rm-tint-2 text-ui-sm font-semibold text-rm-text"
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
                className="absolute inset-0 size-full object-cover"
                onError={(e) => e.currentTarget.remove()}
              />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui-base font-medium text-rm-text">
              {displayName}
            </span>
            {name ? (
              <span className="truncate text-ui-sm text-rm-text-muted">
                {email}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={switchAccount}
            disabled={busy !== null}
            className={`relative flex-none rounded-sm text-ui-sm font-medium text-rm-text-secondary underline decoration-rm-accent-ink/60 underline-offset-[3px] disabled:cursor-not-allowed disabled:opacity-45 pointer-fine:hover:text-rm-text ${HIT}`}
          >
            Not you?<span className="sr-only"> Use another account</span>
          </button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => decide("deny", request)}
            disabled={busy !== null && busy !== "deny"}
            loading={busy === "deny"}
            id="deny-device"
          >
            Deny
          </Button>
          <Button
            size="lg"
            className="w-full"
            onClick={() => decide("approve", request)}
            disabled={busy !== null && busy !== "approve"}
            loading={busy === "approve"}
            id="approve-device"
          >
            Approve
          </Button>
        </div>
        <ErrorStrip>{inlineError}</ErrorStrip>
        <p className="mt-4 text-pretty text-ui-sm text-rm-text-muted">
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
        <Button asChild variant="secondary" size="lg" className="mt-6 w-full">
          <a href="/activate">Enter a different code</a>
        </Button>
      ) : copy.action === "retry" ? (
        <Button
          variant="secondary"
          size="lg"
          className="mt-6 w-full"
          onClick={() => {
            setView({ kind: "loading", code: view.code });
            setLookupNonce((n) => n + 1);
          }}
        >
          Try again
        </Button>
      ) : copy.action === "sign-in" ? (
        <div className="mt-6 flex flex-col gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={switchAccount}
            disabled={busy !== null && busy !== "switch"}
            loading={busy === "switch"}
          >
            Sign in again
          </Button>
          <p className="text-ui-sm text-rm-text-muted">
            Manage two-factor in your{" "}
            <a
              href={`${getKovaAuthUrl()}/settings`}
              className="text-rm-text-secondary underline underline-offset-[3px]"
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

/** Auth loading or a code lookup in flight: same frame as the enter view. */
function LoadingView({
  headingRef,
  code,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  code?: string;
}) {
  return (
    <div className="auth-enter" aria-busy="true">
      <Logo />
      <Heading headingRef={headingRef}>
        {code ? "Checking your code" : "Connect a device"}
      </Heading>
      <Sub>
        {code ? (
          <span className="font-mono tabular-nums">{code}</span>
        ) : (
          "Getting things ready…"
        )}
      </Sub>
      <div
        aria-hidden="true"
        className="mt-6 h-11 animate-pulse rounded-md bg-rm-tint-1 motion-reduce:animate-none"
      />
      <span className="sr-only" role="status">
        Loading
      </span>
    </div>
  );
}
