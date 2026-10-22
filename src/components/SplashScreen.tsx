/**
 * Splash/loading screen for the desktop app.
 *
 * The brand's loading image: the dithered field from the sign-in pages behind
 * the logo, a thin accent progress line and rotating tip messages.
 */

import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useEffect, useReducer } from "react";

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
  const [tipData, dispatch] = useReducer(
    (
      state: { index: number; visible: boolean },
      action: "FADE_OUT" | "FADE_IN_NEXT",
    ) => {
      switch (action) {
        case "FADE_OUT":
          return { ...state, visible: false };
        case "FADE_IN_NEXT":
          return {
            index: (state.index + 1) % LOADING_TIPS.length,
            visible: true,
          };
        default:
          return state;
      }
    },
    { index: 0, visible: true },
  );

  useEffect(() => {
    const interval = setInterval(() => {
      dispatch("FADE_OUT");
      setTimeout(() => {
        dispatch("FADE_IN_NEXT");
      }, 400);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <LoadingScreen className="h-full w-full">
      <p
        className={`text-ui-sm text-rm-text-muted transition-opacity duration-300 ${
          tipData.visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {LOADING_TIPS[tipData.index]}
      </p>
    </LoadingScreen>
  );
}
