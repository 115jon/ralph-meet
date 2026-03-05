/**
 * Discord-style splash/loading screen for the desktop app.
 *
 * Shows the Ralph Meet logo with a breathing animation,
 * an indeterminate loading bar, and rotating fun tip messages.
 */

import splashLogo from "@/assets/splash-logo.svg?url";
import { useEffect, useState } from "react";

const LOADING_TIPS = [
  "Warming up the servers...",
  "Connecting you to the conversation...",
  "Getting everything ready...",
  "Almost there...",
  "Loading your messages...",
  "Preparing your workspace...",
  "Syncing your channels...",
  "Polishing the pixels...",
  "Tuning the microphones...",
  "Rounding up the bytes...",
];

export function SplashScreen() {
  const [tipData, setTipData] = useState({ index: 0, visible: true });

  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out
      setTipData((prev) => ({ ...prev, visible: false }));
      setTimeout(() => {
        // Swap tip and fade in
        setTipData((prev) => ({
          index: (prev.index + 1) % LOADING_TIPS.length,
          visible: true,
        }));
      }, 400);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-rm-bg-primary relative overflow-hidden font-sans select-none">
      {/* Subtle radial glow behind the logo */}
      <div
        className="absolute top-[45%] left-1/2 w-[320px] h-[320px] rounded-full bg-[radial-gradient(circle,var(--rm-glow)_0%,transparent_70%)] -translate-x-1/2 -translate-y-1/2 pointer-events-none animate-splash-glow"
      />

      {/* Logo with breathing animation */}
      <div className="w-24 h-24 z-10 flex items-center justify-center animate-splash-breathe">
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
        <div className="absolute top-0 h-full rounded-full bg-gradient-to-r from-[#5865f2] to-[#7c8af4] animate-splash-bar" />
      </div>

      {/* Rotating tip text */}
      <p
        className={`mt-5 text-[13px] font-normal tracking-[0.01em] transition-opacity duration-400 z-10 text-rm-text-muted ${tipData.visible ? "opacity-100" : "opacity-0"
          }`}
      >
        {LOADING_TIPS[tipData.index]}
      </p>

      {/* Specific keyframes and animation classes */}
      <style>{`
        @keyframes splash-breathe {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes splash-bar {
          0% { left: -40%; width: 40%; }
          50% { left: 30%; width: 50%; }
          100% { left: 110%; width: 30%; }
        }
        @keyframes splash-glow {
          0%, 100% { opacity: 0.25; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.45; transform: translate(-50%, -50%) scale(1.1); }
        }
        .animate-splash-breathe {
          animation: splash-breathe 2.8s ease-in-out infinite;
        }
        .animate-splash-bar {
          animation: splash-bar 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        .animate-splash-glow {
          animation: splash-glow 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
