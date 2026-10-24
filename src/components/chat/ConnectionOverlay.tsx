import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useReducer } from "react";

interface ConnectionOverlayState {
  visible: boolean;
  fadeOut: boolean;
  hasConnected: boolean;
  tipIndex: number;
  tipVisible: boolean;
}

const LOADING_TIPS = [
  "Warming up the servers...",
  "Connecting you to the conversation...",
  "Getting everything ready...",
  "Almost there...",
  "Loading your messages...",
  "Preparing your workspace...",
  "Syncing your channels...",
  "Polishing the pixels...",
];

const RECONNECT_TIPS = [
  "Reconnecting you to the conversation...",
  "Hang tight, we're working on it...",
  "Your messages are safe — reconnecting...",
  "Checking the connection...",
  "Still trying to reach the server...",
  "The server might be taking a break...",
  "We haven't given up yet...",
  "Dusting off the cables...",
];

/**
 * Full-screen overlay shown on initial load while the WebSocket gateway is
 * connecting, and again whenever it disconnects and starts reconnecting.
 * Same composition as the splash: dithered field, logo, accent progress
 * line, status and a rotating tip. Fades out when connection is established.
 */
export function ConnectionOverlay({
  initialHasConnected = false,
}: {
  /**
   * Start as if a connection had already been made, so a disconnect reads as
   * "Reconnecting". Fixtures and tests use it; the app learns it at runtime.
   */
  initialHasConnected?: boolean;
} = {}) {
  const connected = useChatStore((s) => s.connected);
  const reconnectAttempt = useChatStore((s) => s.reconnectAttempt);

  // Overlay and Tip state combined into one object to fix `react-doctor` cascading state limits
  const [state, dispatch] = useReducer(
    (
      prev: ConnectionOverlayState,
      next: Partial<ConnectionOverlayState>,
    ): ConnectionOverlayState => ({ ...prev, ...next }),
    {
      visible: true,
      fadeOut: false,
      hasConnected: initialHasConnected,
      tipIndex: 0,
      tipVisible: true,
    },
  );

  const isReconnecting = state.hasConnected && !connected;
  const tips = isReconnecting ? RECONNECT_TIPS : LOADING_TIPS;

  const handleConnectionState = useCallback(() => {
    let timer1: NodeJS.Timeout;
    let timer2: NodeJS.Timeout;

    if (!connected) {
      // On initial load, show overlay immediately.
      // On reconnect, add a grace period — Cloudflare edge recycles cause
      // brief ChatGW disconnects (~1-2s) that don't affect audio (SFU is
      // on a separate WS). No need to flash a scary overlay for that.
      const delay = state.hasConnected ? 3000 : 0;
      timer1 = setTimeout(() => {
        dispatch({ visible: true, fadeOut: false });
      }, delay);
    } else if (connected && state.visible) {
      // Just connected — record it and fade out
      timer1 = setTimeout(() => {
        dispatch({ hasConnected: true, fadeOut: true });
      }, 0);
      timer2 = setTimeout(() => {
        dispatch({ visible: false, fadeOut: false });
      }, 1200);
    }

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [connected, state.visible, state.hasConnected]);

  useEffect(() => {
    return handleConnectionState();
  }, [handleConnectionState]);

  // Rotate tips
  useEffect(() => {
    if (!state.visible || state.fadeOut) return;
    let tipTimeout: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      dispatch({ tipVisible: false });
      tipTimeout = setTimeout(() => {
        dispatch({
          tipIndex: (state.tipIndex + 1) % tips.length,
          tipVisible: true,
        });
      }, 400);
    }, 3500);
    return () => {
      clearInterval(interval);
      if (tipTimeout) clearTimeout(tipTimeout);
    };
  }, [state.visible, state.fadeOut, state.tipIndex, tips.length]);

  if (!state.visible) return null;

  const getStatusText = () => {
    if (state.fadeOut) return "Connected!";
    if (!state.hasConnected) return "Connecting…";
    if (reconnectAttempt <= 1) return "Reconnecting…";
    if (reconnectAttempt <= 5)
      return `Reconnecting — attempt ${reconnectAttempt}`;
    return `Still reconnecting — attempt ${reconnectAttempt}`;
  };

  // Skip the fade-in on the initial connection (!hasConnected): the pending
  // SplashScreen was already solid, so starting from opacity 0 would flash.
  const animationClass = state.fadeOut
    ? "rm-loading-exit"
    : state.hasConnected
      ? "animate-in fade-in duration-300"
      : "";

  return (
    <LoadingScreen
      logoAlt=""
      logoTestId="connection-overlay-logo"
      className={`fixed inset-0 z-100 pt-[var(--safe-area-top,0px)] pb-[var(--safe-area-bottom,0px)] ${animationClass}`}
    >
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-ui-base font-medium text-rm-text"
      >
        {getStatusText()}
      </p>

      {/* Rotating tip; keep its space reserved during fade-out to avoid shifting the stack. */}
      <p
        aria-hidden="true"
        className={`mt-1 min-h-5 text-ui-sm text-rm-text-muted transition-opacity duration-300 ${
          state.fadeOut
            ? "invisible opacity-0"
            : state.tipVisible
              ? "opacity-100"
              : "opacity-0"
        }`}
      >
        {tips[state.tipIndex]}
      </p>
    </LoadingScreen>
  );
}
