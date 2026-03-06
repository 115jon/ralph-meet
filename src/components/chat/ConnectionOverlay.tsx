import splashLogo from "@/assets/splash-logo.svg";
import { useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useReducer } from "react";

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
 * Full-screen overlay — Discord-style splash/reconnection screen.
 *
 * Shows on initial load while the WebSocket gateway is connecting,
 * and again whenever it disconnects and starts reconnecting.
 * Displays the logo with a breathing animation, an indeterminate
 * loading bar, status text, and rotating tip messages.
 * Fades out when connection is established.
 */
export function ConnectionOverlay() {
  const connected = useChatStore((s) => s.connected);
  const reconnectAttempt = useChatStore((s) => s.reconnectAttempt);

  // Overlay and Tip state combined into one object to fix `react-doctor` cascading state limits
  const [state, dispatch] = useReducer(
    (prev: any, next: any) => ({ ...prev, ...next }),
    {
      visible: true,
      fadeOut: false,
      hasConnected: false,
      tipIndex: 0,
      tipVisible: true,
    }
  );

  const isReconnecting = state.hasConnected && !connected;
  const tips = isReconnecting ? RECONNECT_TIPS : LOADING_TIPS;

  const handleConnectionState = useCallback(() => {
    let timer1: NodeJS.Timeout;
    let timer2: NodeJS.Timeout;

    if (!connected) {
      // Show overlay whenever disconnected (initial or reconnect)
      timer1 = setTimeout(() => {
        dispatch({ visible: true, fadeOut: false });
      }, 0);
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
  }, [connected, state.visible]);

  useEffect(() => {
    return handleConnectionState();
  }, [handleConnectionState]);

  // Rotate tips
  useEffect(() => {
    if (!state.visible || state.fadeOut) return;
    const interval = setInterval(() => {
      dispatch({ tipVisible: false });
      setTimeout(() => {
        dispatch({
          tipIndex: (state.tipIndex + 1) % tips.length,
          tipVisible: true,
        });
      }, 400);
    }, 3500);
    return () => clearInterval(interval);
  }, [state.visible, state.fadeOut, state.tipIndex, tips.length]);

  if (!state.visible) return null;

  const getStatusText = () => {
    if (state.fadeOut) return "Connected!";
    if (!state.hasConnected) return "Connecting...";
    if (reconnectAttempt <= 1) return "Reconnecting...";
    if (reconnectAttempt <= 5) return `Reconnecting — attempt ${reconnectAttempt}`;
    return `Still reconnecting — attempt ${reconnectAttempt}`;
  };

  // Determine the correct animation class.
  // We skip the fade-in animation on the initial connection (!hasConnected)
  // because the pendingComponent (SplashScreen) was already solid; starting from opacity: 0 causes a flash.
  const animationClass = state.fadeOut
    ? "animate-[conn-fade-out_1.2s_ease-in_forwards]"
    : state.hasConnected
      ? "animate-[conn-fade-in_0.3s_ease-out]"
      : "";

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-rm-bg-primary font-sans select-none overflow-hidden ${animationClass}`}
    >
      {/* Radial glow */}
      <div
        className="absolute top-[45%] left-1/2 w-[320px] h-[320px] rounded-full pointer-events-none animate-[conn-glow_3s_ease-in-out_infinite]"
        style={{
          background: "radial-gradient(circle, var(--rm-glow) 0%, transparent 70%)",
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* Logo with breathing animation */}
      <div className="w-24 h-24 z-10 flex items-center justify-center animate-[conn-breathe_2.8s_ease-in-out_infinite]">
        <div
          className="w-full h-full bg-rm-text"
          style={{
            WebkitMaskImage: `url(${splashLogo})`,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskImage: `url(${splashLogo})`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
        />
      </div>

      {/* Loading bar */}
      <div className="mt-9 w-[200px] h-1 rounded-full bg-rm-bg-active overflow-hidden relative z-10">
        <div className="absolute top-0 h-full rounded-full bg-gradient-to-r from-[#5865f2] to-[#7c8af4] animate-[conn-bar_1.8s_cubic-bezier(0.4,0,0.2,1)_infinite]" />
      </div>

      {/* Status text */}
      <p className="mt-5 text-sm font-semibold tracking-[0.01em] z-10 text-rm-text-secondary">
        {getStatusText()}
      </p>

      {/* Rotating tip */}
      {!state.fadeOut && (
        <p
          className={`mt-2 text-[13px] font-normal tracking-[0.01em] z-10 text-rm-text-muted transition-opacity duration-400 ${state.tipVisible ? "opacity-100" : "opacity-0"
            }`}
        >
          {RECONNECT_TIPS[state.tipIndex]}
        </p>
      )}

      {/* Keyframe definitions */}
      <style>{`
        @keyframes conn-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes conn-fade-out {
          0% { opacity: 1; }
          60% { opacity: 1; }
          100% { opacity: 0; pointer-events: none; }
        }
        @keyframes conn-breathe {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes conn-bar {
          0% { left: -40%; width: 40%; }
          50% { left: 30%; width: 50%; }
          100% { left: 110%; width: 30%; }
        }
        @keyframes conn-glow {
          0%, 100% { opacity: 0.25; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.45; transform: translate(-50%, -50%) scale(1.1); }
        }
      `}</style>
    </div>
  );
}
