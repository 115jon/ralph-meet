import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { LedLabel, type LedState } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import { signInFromHere } from "@/lib/sign-in-here";
import { connectionStatus } from "@/lib/voice/connection-status-label";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";

export type ConnectionBannerState =
  | "connecting"
  | "reconnecting"
  | "failed"
  | "offline"
  | "signed-out"
  | "back";

/**
 * One connection problem, from either link: the chat gateway or a call's
 * SFU session. The strip shows the worst one, or both merged into one line.
 */
export interface ConnectionIssue {
  source: "chat" | "call";
  state: ConnectionBannerState;
  /** The status word, printed in silkscreen beside its LED. */
  message: string;
  /** One line of what it means for you, in ink-2. */
  detail?: string;
  /** Reconnect attempt, shown in Num when above 1. */
  attempt?: number;
  /** Offered as Retry (failed) or Retry now (reconnecting). */
  retry?: () => void;
  /** Offered as Sign in (signed-out). */
  signIn?: () => void;
}

const LOOK: Record<
  ConnectionBannerState,
  { led: LedState | null; tint: string }
> = {
  connecting: { led: null, tint: "bg-tint-1" },
  reconnecting: { led: "idle", tint: "bg-warning-tint" },
  failed: { led: "muted", tint: "bg-danger-tint" },
  offline: { led: "off", tint: "bg-danger-tint" },
  "signed-out": { led: "muted", tint: "bg-danger-tint" },
  back: { led: "talk", tint: "bg-success-tint" },
};

/**
 * The connection strip (variant A, picked 2026-10-30): an LED word, one line
 * of what it means, the attempt count and at most one key, under a header.
 * It sits in the flow, so it pushes the messages down instead of covering
 * the first line, and it never blocks: the chat stays readable and the
 * composer stays live (sending is plain HTTP, not the gateway socket). On a
 * phone the detail drops to its own line under the word.
 *
 * `placement` names the slot it is in: `column` (under the chat header, or
 * on top of a view without one) or `stage` (VoiceStage's banner slot).
 */
export function ConnectionBanner({
  state,
  message,
  detail,
  attempt,
  onRetry,
  onSignIn,
  placement = "column",
  className,
}: {
  state: ConnectionBannerState;
  message: string;
  detail?: string;
  attempt?: number;
  onRetry?: () => void;
  onSignIn?: () => void;
  placement?: "column" | "stage";
  className?: string;
}) {
  const look = LOOK[state];
  const showAttempt =
    attempt !== undefined && attempt > 1 && state === "reconnecting";
  const announcement = detail ? `${message}. ${detail}` : message;
  return (
    <div
      data-slot="connection-banner"
      data-state={state}
      data-placement={placement}
      className={cn(
        "relative z-10 flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line bg-ply-0 px-4 py-1",
        "transition-opacity duration-(--dur-3) ease-out starting:opacity-0",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-0", look.tint)}
      />
      {/* The words are read from this live region; the visible copy is
          hidden from assistive tech so it is not read twice. The attempt
          counter and the key stay outside it, so a ticking "Try 3" never
          re-announces the whole strip. */}
      <BannerAnnouncer text={announcement} />
      {look.led ? (
        <LedLabel aria-hidden state={look.led} className="relative shrink-0">
          {message}
        </LedLabel>
      ) : (
        <span
          aria-hidden
          className="relative flex shrink-0 items-center gap-2 text-ink-2"
        >
          <span aria-hidden className="rm-spinner size-3 text-ink-3" />
          <span className="silkscreen">{message}</span>
        </span>
      )}
      {detail ? (
        <span
          aria-hidden
          className="relative min-w-0 text-ui-xs text-ink-2 max-md:order-last max-md:basis-full md:flex-1 md:truncate"
        >
          {detail}
        </span>
      ) : null}
      <span className="relative ml-auto flex shrink-0 items-center gap-3">
        {showAttempt ? (
          <span className="silkscreen text-ink-3">
            Try <Num>{attempt}</Num>
          </span>
        ) : null}
        {state === "signed-out" && onSignIn ? (
          <Button
            size="sm"
            variant="primary"
            className="h-6"
            onClick={onSignIn}
          >
            Sign in
          </Button>
        ) : onRetry && (state === "failed" || state === "reconnecting") ? (
          <Button
            type="button"
            size="xs"
            variant={state === "failed" ? "secondary" : "ghost"}
            onClick={onRetry}
          >
            {state === "failed" ? "Retry" : "Retry now"}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The strip's live region. It mounts empty and fills a beat later: a region
 * that arrives already holding its text is not announced by most screen
 * readers, and the strip mounts with its first message. After that it
 * changes only when the words do (a new state), never on the attempt count.
 */
function BannerAnnouncer({ text }: { text: string }) {
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSpoken(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [text]);
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {spoken}
    </span>
  );
}

/** Long enough for the empty region to be in the accessibility tree. */
const ANNOUNCE_DELAY_MS = 100;

// ── Sources ────────────────────────────────────────────────────────────

/** A call's connection state as an issue; `null` while it is healthy. */
export function callConnectionIssue(
  connectionState: string | null | undefined,
  joined: boolean,
  retry?: () => void,
): ConnectionIssue | null {
  const { tone } = connectionStatus(connectionState, joined);
  if (tone === "good") return null;
  if (tone === "pending") {
    return {
      source: "call",
      state: "connecting",
      message: "Connecting",
      detail: "Joining the call.",
    };
  }
  if (tone === "warning") {
    return {
      source: "call",
      state: "reconnecting",
      message: "Reconnecting",
      detail: "The call dropped. Trying again.",
    };
  }
  return {
    source: "call",
    state: "failed",
    message: "Call lost",
    detail: "Couldn't reconnect to the call.",
    retry,
  };
}

const RANK: Record<ConnectionBannerState, number> = {
  back: -1,
  connecting: 0,
  reconnecting: 1,
  failed: 2,
  offline: 3,
  "signed-out": 4,
};

/**
 * Both links at once still make one strip. The worse state wins the tone
 * and the word; the other link adds a clause to the detail, and Retry
 * retries everything that failed. Offline and signed-out take both links
 * down, so they speak alone.
 */
export function mergeConnectionIssues(
  chat: ConnectionIssue | null,
  call: ConnectionIssue | null,
): ConnectionIssue | null {
  // Joining a call is not a problem: a chat drop speaks over it.
  if (call?.state === "connecting" && chat) call = null;
  // "Back online" is chat news; a live call problem outranks it.
  if (chat?.state === "back" && call) chat = null;
  if (!chat || !call) return chat ?? call;
  if (RANK[chat.state] >= RANK.offline) return chat;

  const state = RANK[chat.state] >= RANK[call.state] ? chat.state : call.state;
  const retries = [chat, call]
    .filter((issue) => issue.retry)
    .map((issue) => issue.retry!);
  const retry =
    retries.length > 0 ? () => retries.forEach((run) => run()) : undefined;

  if (chat.state === call.state) {
    return state === "failed"
      ? {
          source: "call",
          state,
          message: "No link",
          detail: "Can't reach chat or the call.",
          retry,
        }
      : {
          source: "call",
          state,
          message: "Reconnecting",
          detail: "Chat and the call dropped. Trying again.",
          attempt: chat.attempt,
          retry,
        };
  }
  if (call.state === "failed") {
    return {
      ...call,
      detail: "Couldn't reconnect to the call. Chat is reconnecting too.",
      retry,
    };
  }
  return { ...chat, detail: "The call is reconnecting too.", retry };
}

// ── Coordination ───────────────────────────────────────────────────────

interface ConnectionBannerSlots {
  /** The chat gateway's current issue, published by GatewayConnectionBanner. */
  chat: ConnectionIssue | null;
  /** The column's issue (chat merged with an on-screen DM call). */
  column: ConnectionIssue | null;
  /** Mounted stage banners (VoiceStage's slot) that can carry the chat issue. */
  stageSlots: number;
  /** Mounted column slots (under ChatArea's header). */
  columnSlots: number;
}

const useConnectionBannerSlots = create<ConnectionBannerSlots>(() => ({
  chat: null,
  column: null,
  stageSlots: 0,
  columnSlots: 0,
}));

function useCountSlot(key: "stageSlots" | "columnSlots") {
  useEffect(() => {
    useConnectionBannerSlots.setState((s) => ({ [key]: s[key] + 1 }));
    return () =>
      useConnectionBannerSlots.setState((s) => ({ [key]: s[key] - 1 }));
  }, [key]);
}

function IssueStrip({
  issue,
  placement,
  className,
}: {
  issue: ConnectionIssue;
  placement: "column" | "stage";
  className?: string;
}) {
  return (
    <ConnectionBanner
      placement={placement}
      state={issue.state}
      message={issue.message}
      detail={issue.detail}
      attempt={issue.attempt}
      onRetry={issue.retry}
      onSignIn={issue.signIn}
      className={className}
    />
  );
}

/**
 * The stage's banner slot. It shows the call's state and the chat link's,
 * merged, so a chat drop during a call never stacks a second strip over
 * the stage. While a stage slot is on screen, the column strip stands down
 * (see `deferToStage`).
 */
export function StageConnectionBanner({
  connectionState,
  joined,
  onRetry,
  className,
}: {
  connectionState: string;
  joined: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  const chat = useConnectionBannerSlots((s) => s.chat);
  useCountSlot("stageSlots");
  const issue = mergeConnectionIssues(
    chat,
    callConnectionIssue(connectionState, joined, onRetry),
  );
  if (!issue) return null;
  return <IssueStrip issue={issue} placement="stage" className={className} />;
}

/**
 * The column strip's place under ChatArea's 48px header. While one is
 * mounted, the strip renders here (pushing the messages down) instead of on
 * top of the column.
 */
export function ColumnConnectionSlot() {
  const issue = useConnectionBannerSlots((s) => s.column);
  useCountSlot("columnSlots");
  if (!issue) return null;
  return <IssueStrip issue={issue} placement="column" />;
}

// ── Chat gateway ───────────────────────────────────────────────────────

/** Attempts (about 30s of backoff) before "Reconnecting" turns red. */
const FAILED_AFTER_ATTEMPTS = 5;
/**
 * Edge recycles drop the chat socket for a second or two without touching
 * voice (the SFU has its own socket), so the strip waits before it shows.
 */
const GRACE_MS = 3000;
/** How long "Back online" stays after a drop that was on screen. */
const BACK_MS = 2500;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** `navigator.onLine`, live. Server and unknown read as online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
}

type GatewayBannerState = {
  hasConnected: boolean;
  /** The drop outlived its grace period and is on screen. */
  visible: boolean;
  /** Showing "Back online" after a drop that was on screen. */
  back: boolean;
};

type GatewayBannerEvent =
  /** The link is up: hide the drop, and say "Back online" if it showed. */
  | { type: "connected" }
  /** The drop outlived its grace period. */
  | { type: "show" }
  | { type: "back-done" };

function gatewayBannerReducer(
  prev: GatewayBannerState,
  event: GatewayBannerEvent,
): GatewayBannerState {
  switch (event.type) {
    case "connected":
      return { hasConnected: true, visible: false, back: prev.visible };
    case "show":
      return { ...prev, visible: true, back: false };
    case "back-done":
      return prev.back ? { ...prev, back: false } : prev;
  }
}

export function useChatLinkIssue(
  initialHasConnected: boolean,
): ConnectionIssue | null {
  const connected = useChatStore((s) => s.connected);
  const reconnectAttempt = useChatStore((s) => s.reconnectAttempt);
  const failure = useChatStore((s) => s.gatewayFailure);
  const wake = useChatStore((s) => s.gateway.wake);
  // Ready was seen before this mounted (connectStep stays 3 across a
  // disconnect): coming back to /chat is a reconnect, so the strip owns it.
  const wasReady = useChatStore((s) => s.connectStep >= 3);
  const online = useOnline();
  const [state, send] = useReducer(gatewayBannerReducer, {
    hasConnected: initialHasConnected,
    visible: initialHasConnected,
    back: false,
  });
  const hasConnected = state.hasConnected || wasReady;

  useEffect(() => {
    if (connected) {
      const id = setTimeout(() => send({ type: "connected" }));
      return () => clearTimeout(id);
    }
    if (!hasConnected) return;
    const id = setTimeout(() => send({ type: "show" }), GRACE_MS);
    return () => clearTimeout(id);
  }, [connected, hasConnected]);

  useEffect(() => {
    if (!state.back) return;
    const id = setTimeout(() => send({ type: "back-done" }), BACK_MS);
    return () => clearTimeout(id);
  }, [state.back]);

  const signedOut = !connected && hasConnected && failure === "auth";
  const showing = !connected && hasConnected && state.visible;
  const failed = reconnectAttempt > FAILED_AFTER_ATTEMPTS;
  const back = connected && state.back;
  // Memoised so the published issue changes only when what it says does.
  return useMemo<ConnectionIssue | null>(() => {
    if (signedOut) {
      return {
        source: "chat",
        state: "signed-out",
        message: "Signed out",
        detail:
          "Your session expired, so chat can't connect. Everything on screen is kept.",
        signIn: signInFromHere,
      };
    }
    if (back) {
      return {
        source: "chat",
        state: "back",
        message: "Back online",
        detail: "Live again. New messages are in.",
      };
    }
    if (!showing) return null;
    if (!online) {
      return {
        source: "chat",
        state: "offline",
        message: "Offline",
        detail:
          "This device has no network. Ralph reconnects on its own when it's back.",
      };
    }
    return failed
      ? {
          source: "chat",
          state: "failed",
          message: "No chat link",
          detail:
            "Can't reach the chat server. Ralph keeps trying; new messages catch up when it's back.",
          retry: wake,
        }
      : {
          source: "chat",
          state: "reconnecting",
          message: "Reconnecting",
          detail:
            "The chat link dropped. Keep reading and sending; new messages catch up when it's back.",
          attempt: reconnectAttempt,
          retry: wake,
        };
  }, [signedOut, back, showing, online, failed, reconnectAttempt, wake]);
}

/**
 * The chat column's connection strip. The first connection belongs to the
 * full-screen ConnectionOverlay (nothing is usable yet); every later drop is
 * this strip. It publishes the chat issue for the stage slot and the column
 * issue for ChatArea's slot, and renders on top of the column itself only
 * when neither slot is on screen, so two strips never stack.
 */
export function GatewayConnectionBanner({
  initialHasConnected = false,
  deferToStage = false,
  call = null,
}: {
  /** Start as if a connection had already been made (fixtures, tests). */
  initialHasConnected?: boolean;
  /** The voice stage is the main view: its banner slot carries the issue. */
  deferToStage?: boolean;
  /** A call drop shown in this column (a DM call on screen). */
  call?: ConnectionIssue | null;
} = {}) {
  const chat = useChatLinkIssue(initialHasConnected);
  const stageSlots = useConnectionBannerSlots((s) => s.stageSlots);
  const columnSlots = useConnectionBannerSlots((s) => s.columnSlots);
  const deferred = deferToStage && stageSlots > 0;
  const issue = useMemo(
    () => (deferred ? null : mergeConnectionIssues(chat, call)),
    [deferred, chat, call],
  );

  useEffect(() => {
    useConnectionBannerSlots.setState({ chat, column: issue });
  }, [chat, issue]);
  useEffect(
    () => () => useConnectionBannerSlots.setState({ chat: null, column: null }),
    [],
  );

  if (!issue || columnSlots > 0) return null;
  return <IssueStrip issue={issue} placement="column" />;
}

/**
 * The app's one column strip: the chat link plus a DM call while that
 * call's conversation is on screen (its tiles sit under the same header).
 * A channel call on its stage uses the stage slot instead; a call you are
 * not looking at shows its state in the call strip.
 */
export function AppConnectionBanner({
  stageOnScreen,
}: {
  /** The channel call's stage is the main view. */
  stageOnScreen: boolean;
}) {
  const dmCallOnScreen = useCallStore(
    (s) => s.status === "active" && !!s.channelId,
  );
  const callChannelId = useCallStore((s) => s.channelId);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const callJoined = useCallVoiceStore((s) => s.joined);
  const callConnectionState = useCallVoiceStore((s) => s.connectionState);

  const showCall =
    dmCallOnScreen && callChannelId === activeChannelId && callJoined;
  const call = useMemo(
    () =>
      showCall ? callConnectionIssue(callConnectionState, callJoined) : null,
    [showCall, callConnectionState, callJoined],
  );
  return <GatewayConnectionBanner deferToStage={stageOnScreen} call={call} />;
}
