import { useChatStore } from "@/stores/chat-store";
import { useEffect, useState } from "react";

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
 * Full-screen reconnection overlay — Discord-style splash screen.
 *
 * Appears when the WebSocket gateway is disconnected and we're
 * attempting to reconnect. Shows the logo with a breathing animation,
 * an indeterminate loading bar, reconnection attempt count, and
 * rotating tip messages. Fades out when connection is restored.
 */
export function ConnectionOverlay() {
  const connected = useChatStore((s) => s.connected);
  const reconnectAttempt = useChatStore((s) => s.reconnectAttempt);

  // Track "was disconnected" to know when to show/fade the overlay
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  // Rotating tip text
  const [tipIndex, setTipIndex] = useState(() =>
    Math.floor(Math.random() * RECONNECT_TIPS.length)
  );
  const [tipVisible, setTipVisible] = useState(true);

  useEffect(() => {
    if (!connected && reconnectAttempt > 0) {
      setVisible(true);
      setFadeOut(false);
    } else if (connected && visible) {
      // Just reconnected — fade out
      setFadeOut(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setFadeOut(false);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [connected, reconnectAttempt, visible]);

  // Rotate tips
  useEffect(() => {
    if (!visible || fadeOut) return;
    const interval = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % RECONNECT_TIPS.length);
        setTipVisible(true);
      }, 400);
    }, 3500);
    return () => clearInterval(interval);
  }, [visible, fadeOut]);

  if (!visible) return null;

  const getStatusText = () => {
    if (fadeOut) return "Connected!";
    if (reconnectAttempt <= 1) return "Reconnecting...";
    if (reconnectAttempt <= 5) return `Reconnecting — attempt ${reconnectAttempt}`;
    return `Still reconnecting — attempt ${reconnectAttempt}`;
  };

  return (
    <div
      className={`connection-splash ${fadeOut ? "connection-splash--fade-out" : ""}`}
    >
      {/* Radial glow */}
      <div className="connection-splash__glow" />

      {/* Logo with breathing animation */}
      <div className="connection-splash__logo">
        <div
          className="connection-splash__logo-mask"
          style={{
            WebkitMaskImage: `url('/icons/splash-logo.svg')`,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskImage: `url('/icons/splash-logo.svg')`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
        />
      </div>

      {/* Loading bar */}
      <div className="connection-splash__bar-track">
        <div className="connection-splash__bar-fill" />
      </div>

      {/* Status text */}
      <p className="connection-splash__status">{getStatusText()}</p>

      {/* Rotating tip */}
      {!fadeOut && (
        <p
          className={`connection-splash__tip ${tipVisible ? "opacity-100" : "opacity-0"}`}
        >
          {RECONNECT_TIPS[tipIndex]}
        </p>
      )}

      <style>{`
        .connection-splash {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--rm-bg-primary);
          font-family: var(--font-sans), 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          user-select: none;
          animation: conn-fade-in 0.3s ease-out;
        }

        .connection-splash--fade-out {
          animation: conn-fade-out 1.2s ease-in forwards;
        }

        .connection-splash__glow {
          position: absolute;
          top: 45%;
          left: 50%;
          width: 320px;
          height: 320px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--rm-glow) 0%, transparent 70%);
          transform: translate(-50%, -50%);
          pointer-events: none;
          animation: conn-glow 3s ease-in-out infinite;
        }

        .connection-splash__logo {
          width: 96px;
          height: 96px;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: conn-breathe 2.8s ease-in-out infinite;
        }

        .connection-splash__logo-mask {
          width: 100%;
          height: 100%;
          background: var(--rm-text-primary);
        }

        .connection-splash__bar-track {
          margin-top: 36px;
          width: 200px;
          height: 4px;
          border-radius: 9999px;
          background: var(--rm-bg-active);
          overflow: hidden;
          position: relative;
          z-index: 10;
        }

        .connection-splash__bar-fill {
          position: absolute;
          top: 0;
          height: 100%;
          border-radius: 9999px;
          background: linear-gradient(90deg, #5865f2, #7c8af4);
          animation: conn-bar 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .connection-splash__status {
          margin-top: 20px;
          font-size: 14px;
          font-weight: 600;
          color: var(--rm-text-secondary);
          z-index: 10;
          letter-spacing: 0.01em;
        }

        .connection-splash__tip {
          margin-top: 8px;
          font-size: 13px;
          font-weight: 400;
          color: var(--rm-text-muted);
          z-index: 10;
          letter-spacing: 0.01em;
          transition: opacity 0.4s ease;
        }

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
