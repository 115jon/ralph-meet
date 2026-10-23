import { SplashScreen } from "@/components/SplashScreen";
import { ThemeAwareSplashLogo } from "@/components/ThemeAwareSplashLogo";
import { CopyMorphIcon } from "@/components/auth/CopyMorphIcon";
import { DeviceCodeDisplay } from "@/components/auth/DeviceCodeDisplay";
import { useCopyFeedback } from "@/components/auth/use-copy-feedback";
import { spellUserCode } from "@/components/auth/user-code";
import {
  panelMotion,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/components/auth/device-login-styles";
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
import { useAuth } from "@kova/react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
} from "framer-motion";
import {
  Check,
  CircleAlert,
  ExternalLink,
  Link2,
  ShieldX,
  TimerOff,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView } from "./ui/safe-area-view";

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

function DeviceSignInScreen({ isSignedIn }: { isSignedIn: boolean }) {
  const navigate = useNavigate();
  const device = useMemo(() => getDeviceInfo(), []);
  const { state, start, cancel } = useDeviceSignIn({
    authUrl: getKovaAuthUrl(),
    publishableKey: KOVA_AUTH_PUBLISHABLE_KEY,
    device,
  });
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
    <MotionConfig reducedMotion="user">
      <SafeAreaView className="items-center justify-center overflow-y-auto bg-rm-bg-primary px-6 py-8">
        <main className="relative flex w-full max-w-[360px] flex-col items-center">
          <p className="sr-only" role="status" aria-live="polite">
            {announcementFor(view, state)}
          </p>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.section
              key={view}
              {...panelMotion}
              className="flex w-full flex-col items-center text-center"
              aria-labelledby={`device-login-${view}-title`}
            >
              {panel}
            </motion.section>
          </AnimatePresence>
        </main>
      </SafeAreaView>
    </MotionConfig>
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
            icon={Check}
            tone="accent"
            title="You're in"
            body="Opening Ralph Meet…"
          />
        );
      case "verify-unreachable":
        return (
          <StatusPanel
            titleId={titleId}
            icon={WifiOff}
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
            icon={CircleAlert}
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
            icon={ShieldX}
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
            icon={TimerOff}
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
            icon={retryable ? WifiOff : CircleAlert}
            title={
              mfaRequired
                ? "Two-step verification required"
                : retryable
                  ? "Couldn't reach sign-in"
                  : "Sign-in isn't available"
            }
            body={
              mfaRequired
                ? "Your organization requires two-step verification. Turn it on in your account settings, then try again."
                : retryable
                  ? "Check your internet connection, then try again."
                  : "Something went wrong on our side. Try again in a moment."
            }
            actionLabel="Try again"
            onAction={handleStart}
            busy={starting}
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
        ? "Two-step verification is required for this account."
        : "Couldn't start sign-in.";
  }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const titleClass =
  "text-ui-2xl leading-[1.1] font-normal tracking-[-0.01em] text-rm-text outline-none [font-family:var(--font-display)]";
const bodyClass =
  "max-w-[300px] text-ui-sm leading-relaxed text-pretty text-rm-text-secondary";

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
      <ThemeAwareSplashLogo className="mb-6 h-16 w-16 select-none" />
      <h1 id={titleId} className={titleClass}>
        Ralph Meet
      </h1>
      <p className={`${bodyClass} mt-2`}>
        Sign in to pick up where you left off.
      </p>
      <button
        ref={buttonRef}
        type="button"
        onClick={starting ? undefined : onStart}
        aria-disabled={starting || undefined}
        aria-busy={starting || undefined}
        className={`${primaryButton} mt-8`}
      >
        {starting ? (
          <>
            <WaitingDot tone="onAccent" />
            Getting your code…
          </>
        ) : (
          <>
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            Sign in with browser
          </>
        )}
      </button>
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
      <h1 id={titleId} ref={titleRef} tabIndex={-1} className={titleClass}>
        Check your browser
      </h1>
      <p className={`${bodyClass} mt-2`}>
        Make sure it shows this same code, then confirm.
      </p>

      <div className="mt-7 w-full">
        <DeviceCodeDisplay userCode={userCode} />
      </div>

      <div className="mt-4 flex h-5 items-center justify-center gap-2 text-ui-sm text-rm-text-muted">
        {secondsLeft !== null ? (
          <span className="tabular-nums">
            Code expires in {formatSeconds(secondsLeft)}
          </span>
        ) : (
          <>
            <WaitingDot />
            <span>Waiting for you to confirm</span>
          </>
        )}
      </div>

      {openFailed && (
        <p className="mt-3 text-ui-sm leading-relaxed text-rm-text-secondary">
          Couldn't open your browser. Copy the link and open it yourself.
        </p>
      )}

      <div className="mt-7 grid w-full grid-cols-2 gap-2">
        <button type="button" onClick={onOpenAgain} className={secondaryButton}>
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
          Open browser again
        </button>
        <button
          type="button"
          onClick={() => void link.copy(verificationUrl)}
          className={secondaryButton}
        >
          <CopyMorphIcon copied={linkCopied} icon={Link2} />
          {linkCopied
            ? "Link copied"
            : link.status === "failed"
              ? "Couldn't copy"
              : "Copy link"}
        </button>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className={`${quietButton} mt-4`}
      >
        Cancel
      </button>
    </>
  );
}

function StatusPanel({
  titleId,
  icon: Icon,
  tone = "neutral",
  title,
  body,
  actionLabel,
  onAction,
  busy = false,
  waiting = false,
}: {
  titleId: string;
  icon?: LucideIcon;
  tone?: "neutral" | "accent";
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
  waiting?: boolean;
}) {
  const hasAction = !!(actionLabel && onAction);
  const titleRef = useFocusOnMount<HTMLHeadingElement>(!hasAction);
  const actionRef = useFocusOnMount<HTMLButtonElement>(hasAction);

  return (
    <>
      <div
        aria-hidden="true"
        className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border ${
          tone === "accent"
            ? "border-transparent bg-rm-accent-dim text-rm-accent"
            : "border-rm-border bg-rm-bg-elevated text-rm-text-secondary"
        }`}
      >
        {Icon ? <Icon className="h-6 w-6" /> : <WaitingDot size="lg" />}
      </div>
      <h1 id={titleId} ref={titleRef} tabIndex={-1} className={titleClass}>
        {title}
      </h1>
      <p className={`${bodyClass} mt-2`}>{body}</p>
      {waiting && <span className="sr-only">In progress</span>}
      {hasAction && (
        <button
          ref={actionRef}
          type="button"
          onClick={busy ? undefined : onAction}
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          className={`${primaryButton} mt-8`}
        >
          {busy ? (
            <>
              <WaitingDot tone="onAccent" />
              Getting a new code…
            </>
          ) : (
            actionLabel
          )}
        </button>
      )}
    </>
  );
}

/** Minimal "still working" indicator: one dot breathing in opacity only. */
function WaitingDot({
  tone = "accent",
  size = "sm",
}: {
  tone?: "accent" | "onAccent";
  size?: "sm" | "lg";
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      className={`inline-block rounded-full ${size === "lg" ? "h-2.5 w-2.5" : "h-1.5 w-1.5"} ${
        tone === "onAccent" ? "bg-white" : "bg-rm-accent"
      }`}
      animate={reduceMotion ? { opacity: 0.8 } : { opacity: [0.35, 1, 0.35] }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 1.6, ease: "easeInOut", repeat: Infinity }
      }
    />
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
