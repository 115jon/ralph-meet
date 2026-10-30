import { SplashScreen } from "@/components/SplashScreen";
import { CopyMorphIcon } from "@/components/auth/CopyMorphIcon";
import { DeviceCodeDisplay } from "@/components/auth/DeviceCodeDisplay";
import { useCopyFeedback } from "@/components/auth/use-copy-feedback";
import { spellUserCode } from "@/components/auth/user-code";
import {
  Notice,
  PublicActions,
  PublicBody,
  PublicFrame,
  PublicTitle,
  StatusTile,
  type StatusTone,
} from "@/components/auth/PublicFrame";
import { Button, Spinner } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { LedLabel } from "@/components/ui/led";
import { clog } from "@/lib/console-logger";
import {
  clearDesktopAuthSession,
  setDesktopAuthSession,
  waitForDesktopToken,
} from "@/lib/desktop-auth";
import {
  getDeviceInfo,
  useDeviceSignIn,
  type DeviceSignInHookState,
} from "@/lib/device-sign-in";
import {
  getKovaAuthUrl,
  KOVA_AUTH_PUBLISHABLE_KEY,
} from "@/lib/kova-auth-config";
import { apiUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAuth } from "@kova/react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const log = clog("DesktopLogin");

/** How long the "You're in" state stays up before opening the app. */
export const SIGN_IN_SUCCESS_HOLD_MS = 600;
/** Only surface the expiry time once it is this close. */
const EXPIRY_WARNING_SECONDS = 60;

type SessionCheck = "ok" | "rejected" | "unreachable";

type FinishState =
  | { kind: "none" }
  | { kind: "verifying" }
  | { kind: "success" }
  | { kind: "failed"; reason: "rejected" | "unreachable"; token: string };

type View =
  | "idle"
  | "pending"
  | "verifying"
  | "success"
  | "verify-unreachable"
  | "verify-rejected"
  | "denied"
  | "expired"
  | "error";

/**
 * Desktop/mobile sign-in via device code.
 *
 * The app asks Kova for a short code, opens the verification page in the
 * system browser, and polls until the user confirms the same code there.
 * The returned session token is validated against the Ralph Meet API before
 * it is persisted.
 */
export default function DesktopLogin() {
  const [resolving, setResolving] = useState(true);
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function resolveExistingDesktopSession() {
      const token = await waitForDesktopToken(1800);
      if (cancelled) return;
      if (!token) {
        setResolving(false);
        return;
      }
      const check = await validateDesktopSession(token);
      if (cancelled) return;
      if (check === "rejected") {
        clearDesktopAuthSession();
        setResolving(false);
        return;
      }
      // "unreachable" keeps the stored session: being offline at launch
      // should not sign the user out. The app shell handles reconnecting.
      navigate({ to: "/chat", replace: true });
    }

    void resolveExistingDesktopSession();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (resolving) return <SplashScreen />;

  return <DeviceSignInScreen isSignedIn={isSignedIn} />;
}

/**
 * The sign-in screen itself. `signIn` overrides the device-code hook for
 * fixtures and previews (the hook still mounts, idle, so hook order holds).
 */
export function DeviceSignInScreen({
  isSignedIn,
  signIn,
}: {
  isSignedIn: boolean;
  signIn?: ReturnType<typeof useDeviceSignIn>;
}) {
  const navigate = useNavigate();
  const device = useMemo(() => getDeviceInfo(), []);
  const realSignIn = useDeviceSignIn({
    authUrl: getKovaAuthUrl(),
    publishableKey: KOVA_AUTH_PUBLISHABLE_KEY,
    device,
  });
  const { state, start, cancel } = signIn ?? realSignIn;
  const [finish, setFinish] = useState<FinishState>({ kind: "none" });
  const [hasInteracted, setHasInteracted] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  // While a fresh code is being requested, keep showing the screen the user
  // retried from (with a busy button) instead of flashing back to idle.
  const [startedFrom, setStartedFrom] = useState<View>("idle");
  const handledTokenRef = useRef<string | null>(null);
  const openedUrlRef = useRef<string | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const finishSignIn = useCallback(
    async (token: string) => {
      const check = await validateDesktopSession(token);
      if (!mountedRef.current) return;
      if (check !== "ok") {
        log.warn("Device sign-in token failed validation", { check });
        setFinish({ kind: "failed", reason: check, token });
        return;
      }
      setDesktopAuthSession(token);
      setFinish({ kind: "success" });
      successTimerRef.current = window.setTimeout(() => {
        successTimerRef.current = null;
        navigate({ to: "/chat", replace: true });
      }, SIGN_IN_SUCCESS_HOLD_MS);
    },
    [navigate],
  );

  // Approved → validate before persisting.
  useEffect(() => {
    if (state.status !== "approved") return;
    if (handledTokenRef.current === state.sessionToken) return;
    handledTokenRef.current = state.sessionToken;
    void finishSignIn(state.sessionToken);
  }, [state, finishSignIn]);

  // Open the server-provided verification URL once per code.
  const pendingUrl =
    state.status === "pending" ? state.verificationUriComplete : null;
  useEffect(() => {
    if (!pendingUrl || openedUrlRef.current === pendingUrl) return;
    openedUrlRef.current = pendingUrl;
    void openInSystemBrowser(pendingUrl).then((opened) => {
      if (!opened && mountedRef.current) setOpenFailed(true);
    });
  }, [pendingUrl]);

  const view = deriveView(state, finish, startedFrom);
  const firstViewRef = useRef(view);
  const starting = state.status === "starting";

  const handleStart = useCallback(() => {
    if (starting) return;
    setStartedFrom(view);
    handledTokenRef.current = null;
    openedUrlRef.current = null;
    setOpenFailed(false);
    setFinish({ kind: "none" });
    setHasInteracted(true);
    start();
  }, [start, starting, view]);

  const handleCancel = useCallback(() => {
    setFinish({ kind: "none" });
    setHasInteracted(true);
    cancel();
  }, [cancel]);

  const handleOpenAgain = useCallback(async () => {
    if (!pendingUrl) return;
    const opened = await openInSystemBrowser(pendingUrl);
    setOpenFailed(!opened);
  }, [pendingUrl]);

  const handleRetryValidation = useCallback(() => {
    if (finish.kind !== "failed") return;
    const { token } = finish;
    setFinish({ kind: "verifying" });
    void finishSignIn(token);
  }, [finish, finishSignIn]);

  if (view === "idle" && isSignedIn) {
    return <Navigate to="/" replace />;
  }

  const panel = renderPanel();

  return (
    <PublicFrame home={null}>
      <div className="relative">
        <p className="sr-only" role="status" aria-live="polite">
          {announcementFor(view, state)}
        </p>
        {/* Panel swap: the new panel fades up 4px (CSS, no framer-motion in
            the desktop entry). The first panel appears without motion;
            reduced motion keeps the fade only (global rule). */}
        <section
          key={view}
          className={cn(
            "flex w-full flex-col",
            view !== firstViewRef.current &&
              "animate-in fade-in slide-in-from-bottom-1 duration-200",
          )}
          aria-labelledby={`device-login-${view}-title`}
        >
          {panel}
        </section>
      </div>
    </PublicFrame>
  );

  function renderPanel() {
    const titleId = `device-login-${view}-title`;
    switch (view) {
      case "idle":
        return (
          <IdlePanel
            titleId={titleId}
            starting={starting}
            onStart={handleStart}
            focusOnMount={hasInteracted}
          />
        );
      case "pending":
        if (state.status !== "pending") return null;
        return (
          <PendingPanel
            titleId={titleId}
            userCode={state.userCode}
            verificationUrl={state.verificationUriComplete}
            expiresAt={state.expiresAt}
            openFailed={openFailed}
            onOpenAgain={handleOpenAgain}
            onCancel={handleCancel}
          />
        );
      case "verifying":
        return (
          <StatusPanel
            titleId={titleId}
            title="Finishing up"
            body="Checking your account…"
            waiting
          />
        );
      case "success":
        return (
          <StatusPanel
            titleId={titleId}
            icon="check"
            tone="success"
            title="You're in"
            body="Opening Ralph Meet…"
          />
        );
      case "verify-unreachable":
        return (
          <StatusPanel
            titleId={titleId}
            icon="offline"
            tone="danger"
            title="Couldn't finish signing in"
            body="You approved it, but we couldn't reach Ralph Meet to confirm your account. Check your connection."
            actionLabel="Retry"
            onAction={handleRetryValidation}
          />
        );
      case "verify-rejected":
        return (
          <StatusPanel
            titleId={titleId}
            icon="alert"
            tone="danger"
            title="That sign-in didn't go through"
            body="Ralph Meet didn't accept the session. Start over with a fresh code."
            actionLabel="Try again"
            onAction={handleStart}
            busy={starting}
          />
        );
      case "denied":
        return (
          <StatusPanel
            titleId={titleId}
            icon="shieldX"
            title="Sign-in declined"
            body="The request was declined in your browser, so nothing was signed in."
            actionLabel="Try again"
            onAction={handleStart}
            busy={starting}
          />
        );
      case "expired":
        return (
          <StatusPanel
            titleId={titleId}
            icon="timerOff"
            title="That code expired"
            body="Codes only last a few minutes. Get a fresh one to keep going."
            actionLabel="Try again"
            onAction={handleStart}
            busy={starting}
          />
        );
      case "error": {
        const retryable = state.status === "error" ? state.retryable : true;
        const mfaRequired =
          state.status === "error" && state.error === "mfa_required";
        return (
          <StatusPanel
            titleId={titleId}
            icon={mfaRequired ? "shield" : retryable ? "offline" : "alert"}
            tone={mfaRequired ? "accent" : "danger"}
            title={
              mfaRequired
                ? "Two-step verification needed"
                : retryable
                  ? "Couldn't reach sign-in"
                  : "Sign-in isn't available"
            }
            body={
              mfaRequired
                ? "Your account needs two-step verification. Turn it on in your account settings, then try again."
                : retryable
                  ? "Check your internet connection, then try again."
                  : "Something went wrong on our side. Try again in a moment."
            }
            actionLabel="Try again"
            onAction={handleStart}
            busy={starting}
            secondaryLabel={mfaRequired ? "Open account settings" : undefined}
            onSecondary={
              mfaRequired
                ? () => void openInSystemBrowser(`${getKovaAuthUrl()}/settings`)
                : undefined
            }
          />
        );
      }
    }
  }
}

function deriveView(
  state: DeviceSignInHookState,
  finish: FinishState,
  startedFrom: View,
): View {
  if (finish.kind === "verifying") return "verifying";
  if (finish.kind === "success") return "success";
  if (finish.kind === "failed") {
    return finish.reason === "rejected"
      ? "verify-rejected"
      : "verify-unreachable";
  }
  switch (state.status) {
    case "starting":
      return startedFrom === "pending" ? "idle" : startedFrom;
    case "idle":
    case "cancelled":
      return "idle";
    case "pending":
      return "pending";
    case "approved":
      return "verifying";
    case "denied":
      return "denied";
    case "expired":
      return "expired";
    case "error":
      return "error";
  }
}

function announcementFor(view: View, state: DeviceSignInHookState): string {
  if (state.status === "starting") return "Getting a sign-in code.";
  switch (view) {
    case "idle":
      return "";
    case "pending":
      return state.status === "pending"
        ? `Your code is ${spellUserCode(state.userCode)}. Confirm the same code in your browser.`
        : "";
    case "verifying":
      return "Approved. Finishing sign-in.";
    case "success":
      return "Signed in. Opening Ralph Meet.";
    case "verify-unreachable":
      return "Couldn't reach Ralph Meet to finish signing in.";
    case "verify-rejected":
      return "That sign-in didn't go through.";
    case "denied":
      return "Sign-in was declined in the browser.";
    case "expired":
      return "That code expired.";
    case "error":
      return state.status === "error" && state.error === "mfa_required"
        ? "This account needs two-step verification."
        : "Couldn't start sign-in.";
  }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function useFocusOnMount<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus({ preventScroll: true });
    // Mount-only: focus moves when a panel appears, not on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

function IdlePanel({
  titleId,
  starting,
  onStart,
  focusOnMount,
}: {
  titleId: string;
  starting: boolean;
  onStart: () => void;
  focusOnMount: boolean;
}) {
  const buttonRef = useFocusOnMount<HTMLButtonElement>(focusOnMount);
  return (
    <>
      <PublicTitle id={titleId} size="display">
        Sign in to Ralph Meet
      </PublicTitle>
      <PublicBody size="lead">
        Your browser opens to confirm it's you, then you're back here.
      </PublicBody>
      <PublicActions>
        <Button
          ref={buttonRef}
          size="lg"
          onClick={starting ? undefined : onStart}
          aria-disabled={starting || undefined}
          aria-busy={starting || undefined}
        >
          {starting ? (
            <>
              <Spinner />
              Getting your code…
            </>
          ) : (
            <>
              <Icon name="externalLink" size="sm" />
              Sign in with browser
            </>
          )}
        </Button>
      </PublicActions>
    </>
  );
}

function PendingPanel({
  titleId,
  userCode,
  verificationUrl,
  expiresAt,
  openFailed,
  onOpenAgain,
  onCancel,
}: {
  titleId: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  openFailed: boolean;
  onOpenAgain: () => void;
  onCancel: () => void;
}) {
  const titleRef = useFocusOnMount<HTMLHeadingElement>(true);
  const secondsLeft = useSecondsLeftNearExpiry(expiresAt);
  const link = useCopyFeedback();
  const linkCopied = link.status === "copied";

  return (
    <>
      <StatusTile icon="globe" tone="accent" />
      <PublicTitle id={titleId} headingRef={titleRef}>
        Check your browser
      </PublicTitle>
      <PublicBody>Make sure it shows this same code, then confirm.</PublicBody>

      <div className="mt-6 w-full">
        <DeviceCodeDisplay userCode={userCode} />
      </div>

      {/* The expiry line only ticks inside its last minute; before that the
          waiting row is static (an amber LED, no loop). */}
      <div className="mt-4 flex h-5 items-center">
        {secondsLeft !== null ? (
          <LedLabel state="idle">
            Code expires in{" "}
            <span className="tabular-nums">{formatSeconds(secondsLeft)}</span>
          </LedLabel>
        ) : (
          <LedLabel state="idle">Waiting for you to confirm</LedLabel>
        )}
      </div>

      {openFailed && (
        <Notice tone="danger" className="mt-4">
          Couldn't open your browser. Copy the link and open it yourself.
        </Notice>
      )}

      <div className="mt-8 grid w-full grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onOpenAgain}>
          <Icon name="externalLink" size="sm" />
          Open browser again
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => void link.copy(verificationUrl)}
        >
          <CopyMorphIcon copied={linkCopied} icon="link" />
          {linkCopied
            ? "Link copied"
            : link.status === "failed"
              ? "Couldn't copy"
              : "Copy link"}
        </Button>
      </div>

      <Button
        variant="ghost"
        size="lg"
        onClick={onCancel}
        className="mt-2 w-full"
      >
        Cancel
      </Button>
    </>
  );
}

function StatusPanel({
  titleId,
  icon,
  tone = "neutral",
  title,
  body,
  actionLabel,
  onAction,
  busy = false,
  waiting = false,
  secondaryLabel,
  onSecondary,
}: {
  titleId: string;
  icon?: IconName;
  /** The tile's tone; the title stays ink-1 (the tile carries the state). */
  tone?: StatusTone;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
  waiting?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const hasAction = !!(actionLabel && onAction);
  // Focus lands on the heading, not the action: a ring on a button the
  // person never reached for reads as already pressed. Tab reaches it next.
  const titleRef = useFocusOnMount<HTMLHeadingElement>(true);

  return (
    <>
      <StatusTile icon={icon} tone={tone} busy={waiting || !icon} />
      <PublicTitle id={titleId} headingRef={titleRef}>
        {title}
      </PublicTitle>
      <PublicBody>{body}</PublicBody>
      {waiting && <span className="sr-only">In progress</span>}
      {hasAction && (
        <PublicActions>
          <Button
            size="lg"
            onClick={busy ? undefined : onAction}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <>
                <Spinner />
                Getting a new code…
              </>
            ) : (
              actionLabel
            )}
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button variant="ghost" size="lg" onClick={onSecondary}>
              <Icon name="externalLink" size="sm" />
              {secondaryLabel}
            </Button>
          ) : null}
        </PublicActions>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seconds until `expiresAt`, but only once it is within the warning window.
 * Before that it returns null and does not tick, so the screen stays still.
 */
function useSecondsLeftNearExpiry(expiresAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let interval: number | null = null;
    const startTicking = () => {
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 1000);
    };
    const untilWarning = expiresAt - EXPIRY_WARNING_SECONDS * 1000 - Date.now();
    const timeout = window.setTimeout(startTicking, Math.max(0, untilWarning));
    return () => {
      window.clearTimeout(timeout);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [expiresAt]);

  const secondsLeft = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return secondsLeft <= EXPIRY_WARNING_SECONDS ? secondsLeft : null;
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function openInSystemBrowser(url: string): Promise<boolean> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return true;
  } catch (error) {
    log.warn("plugin-opener failed; falling back to window.open", error);
  }
  try {
    // Never navigate this webview away: polling has to keep running here.
    // (`noopener` makes window.open return null, so there is nothing to check.)
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch (error) {
    log.error("Failed to open the sign-in page", error);
    return false;
  }
}

async function validateDesktopSession(
  sessionToken: string,
): Promise<SessionCheck> {
  try {
    const response = await fetch(apiUrl("/api/users/me"), {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Publishable-Key": KOVA_AUTH_PUBLISHABLE_KEY,
      },
    });
    if (response.ok) return "ok";
    if (response.status === 401 || response.status === 403) return "rejected";
    return "unreachable";
  } catch (error) {
    log.warn("Failed to validate desktop session:", error);
    return "unreachable";
  }
}
