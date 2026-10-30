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
 * The review is the kit's C2 poster (DESIGN.md, Dialog): a silkscreen kicker
 * ("Desktop sign-in · 4 min left"), a 40px Bricolage title ("Is this you?",
 * the last word in the accent dither), a body naming the app and the account,
 * the code in Martian 40px, a still dithered expiry bar, and a footer of 48px
 * keys. The surrounding page layout is the public frame's.
 *
 * Signed-out visitors are sent to /sign-in with a path-only, same-origin
 * `redirect_url` back here (see activateReturnPath).
 *
 * "Not you?" releases this account's claim on the code (so the next account
 * can look it up), then signs out straight to that same sign-in URL. If the
 * release fails it still signs out, but lands on a "Code in use" page that
 * asks for a fresh code from the device (`?release=failed`).
 */

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogKicker } from "@/components/ui/dialog";
import { DitherDots, DitherWord } from "@/components/ui/dither";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { HIT } from "@/components/ui/interaction";
import { Skeleton } from "@/components/ui/skeleton";
import { markAuthLogoutIntent } from "@/lib/desktop-auth";
import {
  activateReturnPath,
  formatDeviceCode,
  isCompleteDeviceCode,
  prettyPlatform,
  releaseFailedPath,
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
} from "react";
import { spellUserCode, splitUserCode } from "./user-code";
import {
  ErrorNotice,
  PublicActions,
  PublicBody,
  PublicTitle,
  StatusTile,
  type StatusTone,
} from "./PublicFrame";

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
    title: "Two-step verification needed",
    body: "Your account needs two-step verification before it can approve a device. Sign in again with your second step, then enter the code.",
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

/** Each outcome's status tile: a failure is danger; the rest are neutral. */
const OUTCOME_TILE: Record<Outcome, { icon: IconName; tone: StatusTone }> = {
  denied: { icon: "shieldX", tone: "neutral" },
  expired: { icon: "timerOff", tone: "neutral" },
  invalid: { icon: "alert", tone: "danger" },
  used: { icon: "info", tone: "neutral" },
  claimed: { icon: "lock", tone: "neutral" },
  release_failed: { icon: "lock", tone: "neutral" },
  rate_limited: { icon: "timer", tone: "neutral" },
  mfa_required: { icon: "shield", tone: "accent" },
  network: { icon: "offline", tone: "danger" },
  unavailable: { icon: "alert", tone: "danger" },
};

/** Review rows: label column 112, value column the rest, 12px rhythm. */
const DETAIL_ROW =
  "grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-t border-line py-3";

/**
 * How long a device code lives, for the expiry bar. The SDK exposes only
 * `expiresAt`, and the copy promises "a few minutes", so the bar measures the
 * time left against this window (or against the time left, if that is longer).
 */
const CODE_WINDOW_MS = 10 * 60_000;

/**
 * "Now", refreshed when the whole-minute count of time left changes (and once
 * at expiry). One timeout, aligned to the minute; no interval, no animation,
 * so the kicker and the bar step down and the page is otherwise still.
 */
function useNowByMinute(expiresAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    let id: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = expiresAt - current;
      if (left <= 0) return;
      id = setTimeout(tick, (left % 60_000) + 50);
    };
    tick();
    return () => clearTimeout(id);
  }, [expiresAt]);
  return now;
}

/** "4 min left", "Under 1 min left", "Expired". */
export function timeLeftLabel(msLeft: number): string {
  if (msLeft <= 0) return "Expired";
  const minutes = Math.floor(msLeft / 60_000);
  return minutes < 1 ? "Under 1 min left" : `${minutes} min left`;
}

/** The poster's kicker: what this is, and how long the code has left. */
function ApprovalKicker({ expiresAt }: { expiresAt: number | null }) {
  const now = useNowByMinute(expiresAt);
  return (
    <DialogKicker>
      Desktop sign-in
      {expiresAt === null ? null : ` · ${timeLeftLabel(expiresAt - now)}`}
    </DialogKicker>
  );
}

/** The review's poster details: the code, then how long it has. */
function ApprovalCode({
  userCode,
  expiresAt,
}: {
  userCode: string;
  expiresAt: number | null;
}) {
  const now = useNowByMinute(expiresAt);
  const left = expiresAt === null ? null : expiresAt - now;
  const fraction =
    left === null
      ? null
      : Math.min(1, Math.max(0, left / Math.max(CODE_WINDOW_MS, left)));
  const groups = splitUserCode(userCode);
  return (
    <>
      <p className="mt-4">
        <span className="sr-only">Code: {spellUserCode(userCode)}</span>
        <span
          aria-hidden="true"
          data-testid="device-user-code"
          className="block font-silk text-[32px] leading-none font-semibold tracking-[0.04em] text-ink-1 tabular-nums [font-stretch:100%] select-text min-[380px]:text-[40px]"
        >
          {groups.join("-")}
        </span>
      </p>
      {fraction !== null && expiresAt !== null ? (
        <div className="mt-4 flex items-center gap-3">
          {/* A still dither, set once per render: its width is the time left,
              measured on a faint track the length of the whole window. */}
          <div className="h-2 min-w-0 flex-1 bg-tint-1">
            <DitherDots
              ink="accent"
              coverage={0.5}
              cell={2}
              className="h-full"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <span className="silkscreen shrink-0 text-ink-3">
            Expires{" "}
            {new Date(expiresAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
      ) : null}
    </>
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
        <PublicTitle size="display" headingRef={headingRef}>
          Connect a device
        </PublicTitle>
        <PublicBody size="lead">
          Enter the code shown on your device to sign in to Ralph Meet.
        </PublicBody>
        <form
          className="mt-8 flex flex-col gap-2"
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
            className="h-16 rounded-lg text-center font-mono text-ui-2xl font-semibold uppercase tracking-[0.12em] tabular-nums placeholder:tracking-[0.12em] placeholder:text-ink-3 md:text-ui-2xl"
          />
          <p
            id={codeErrorId}
            role="alert"
            className="text-ui-sm text-danger-ink empty:hidden"
          >
            {message}
          </p>
          <PublicActions className="mt-6">
            <Button type="submit" size="lg">
              Continue
            </Button>
          </PublicActions>
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
    const platform = prettyPlatform(request.device.platform);
    const place = uniqueParts([
      request.requester.city,
      request.requester.country,
    ]).join(", ");
    const ip = request.requester.ip?.trim();
    const name = user?.name?.trim() || "";
    const email = user?.email ?? "";
    const displayName = name || email;
    const parsedExpiry = request.expiresAt
      ? Date.parse(request.expiresAt)
      : Number.NaN;
    const expiresAt = Number.isNaN(parsedExpiry) ? null : parsedExpiry;
    return (
      <div className="auth-enter">
        <section
          data-slot="approval-card"
          className="rounded-[2px] border border-line-strong bg-ply-3 px-6 pt-5 pb-4 text-ink-1 [--plate-ground:var(--ply-3)]"
        >
          <ApprovalKicker expiresAt={expiresAt} />
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-4 font-display [font-optical-sizing:auto] text-[40px] leading-[0.92] font-extrabold tracking-[-0.04em] text-balance text-ink-1 outline-none"
          >
            Is this <DitherWord cell={3}>you?</DitherWord>
          </h1>
          <p className="mt-4 text-ui-base text-pretty text-ink-2 [overflow-wrap:anywhere]">
            Ralph Meet{platform ? ` for ${platform}` : ""} wants to sign in as{" "}
            <span className="font-medium text-ink-1">{displayName}</span>.
          </p>
          <p className="mt-2 text-ui-base text-pretty text-ink-2">
            Only approve if you started this sign-in yourself.
          </p>
          <ApprovalCode userCode={request.userCode} expiresAt={expiresAt} />
          {devicePrimary || place || ip ? (
            <dl className="mt-5 border-b border-line text-ui-sm">
              {devicePrimary ? (
                <div className={DETAIL_ROW}>
                  <dt className="text-ink-3">Device</dt>
                  <dd className="min-w-0 text-ink-1 [overflow-wrap:anywhere]">
                    {devicePrimary}
                    {hostname ? (
                      <span className="block text-ink-2">{hostname}</span>
                    ) : null}
                    <span className="mt-0.5 block text-ui-xs text-ink-3">
                      Reported by the device
                    </span>
                  </dd>
                </div>
              ) : null}
              {place || ip ? (
                <div className={DETAIL_ROW}>
                  <dt className="text-ink-3">Requested from</dt>
                  <dd className="min-w-0 text-ink-1 [overflow-wrap:anywhere]">
                    {place || ip}
                    {place && ip ? (
                      <span
                        className="block truncate font-mono text-num-sm text-ink-2"
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
          <div className="mt-4 flex items-center gap-3 rounded-[2px] bg-tint-1 px-3 py-3">
            <Avatar
              aria-hidden="true"
              name={displayName || "?"}
              src={user?.image}
              size={32}
              ring="ply-3"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ui-row font-medium text-ink-1">
                {displayName}
              </span>
              {name ? (
                <span className="truncate text-ui-sm text-ink-3">{email}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={switchAccount}
              disabled={busy !== null}
              className={`relative flex-none rounded-sm text-ui-sm font-medium text-ink-2 underline decoration-line-strong underline-offset-[3px] disabled:cursor-not-allowed disabled:opacity-45 pointer-fine:hover:text-ink-1 pointer-fine:hover:decoration-ink-2 ${HIT}`}
            >
              Not you?<span className="sr-only"> Use another account</span>
            </button>
          </div>
          <DialogFooter className="mt-6 pt-0">
            <Button
              variant="secondary"
              onClick={() => decide("deny", request)}
              disabled={busy !== null && busy !== "deny"}
              loading={busy === "deny"}
              id="deny-device"
            >
              Deny
            </Button>
            <Button
              onClick={() => decide("approve", request)}
              disabled={busy !== null && busy !== "approve"}
              loading={busy === "approve"}
              id="approve-device"
            >
              <Icon name="check" size="sm" />
              Approve sign-in
            </Button>
          </DialogFooter>
          <ErrorNotice className="mt-3">{inlineError}</ErrorNotice>
        </section>
        {live}
      </div>
    );
  }

  if (view.kind === "approved") {
    return (
      <div className="auth-enter">
        <StatusTile icon="check" tone="success" />
        <PublicTitle headingRef={headingRef}>
          {view.deviceName
            ? `You're signed in on ${view.deviceName}`
            : "You're signed in"}
        </PublicTitle>
        <PublicBody>You can close this tab and go back to the app.</PublicBody>
        <PublicActions>
          <Button asChild variant="secondary" size="lg">
            <a href="/chat">Open Ralph Meet here</a>
          </Button>
        </PublicActions>
        {live}
      </div>
    );
  }

  const copy = OUTCOME_COPY[view.outcome];
  const tile = OUTCOME_TILE[view.outcome];
  const wait =
    view.outcome === "rate_limited"
      ? waitPhrase(view.retryAfterSeconds)
      : undefined;
  const body = wait ? `Wait ${wait} before trying this code again.` : copy.body;
  return (
    <div className="auth-enter">
      <StatusTile icon={tile.icon} tone={tile.tone} />
      <PublicTitle headingRef={headingRef}>{copy.title}</PublicTitle>
      <PublicBody>{body}</PublicBody>
      {copy.action === "enter" ? (
        <PublicActions>
          <Button asChild variant="primary" size="lg">
            <a href="/activate">Enter a different code</a>
          </Button>
        </PublicActions>
      ) : copy.action === "retry" ? (
        <PublicActions>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setView({ kind: "loading", code: view.code });
              setLookupNonce((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </PublicActions>
      ) : copy.action === "sign-in" ? (
        <>
          <PublicActions>
            <Button
              variant="primary"
              size="lg"
              onClick={switchAccount}
              disabled={busy !== null && busy !== "switch"}
              loading={busy === "switch"}
            >
              Sign in again
            </Button>
          </PublicActions>
          <p className="mt-4 text-ui-sm text-ink-3">
            Turn on two-step verification in your{" "}
            <a
              href={`${getKovaAuthUrl()}/settings`}
              className="text-accent-ink underline underline-offset-[3px]"
            >
              account security settings
            </a>
            .
          </p>
        </>
      ) : null}
      {live}
    </div>
  );
}

/**
 * Auth loading or a code lookup in flight: the review's opening geometry
 * (tile, title, body, code box) with static placeholders, so nothing jumps
 * when it resolves.
 */
function LoadingView({
  headingRef,
  code,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  code?: string;
}) {
  return (
    <div className="auth-enter" aria-busy="true">
      <StatusTile busy tone="neutral" />
      <PublicTitle headingRef={headingRef}>
        {code ? "Checking your code" : "Connect a device"}
      </PublicTitle>
      <PublicBody>
        {code ? (
          <span className="font-mono tabular-nums">{code}</span>
        ) : (
          "Getting things ready…"
        )}
      </PublicBody>
      <Skeleton className="mt-6 h-16 rounded-lg" />
      <span className="sr-only" role="status">
        Loading
      </span>
    </div>
  );
}
