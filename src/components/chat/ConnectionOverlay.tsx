import { useOnline } from "@/components/chat/ConnectionBanner";
import {
  ColdLoadScreen,
  type ColdError,
  type ColdStep,
} from "@/components/chat/ColdLoad";
import { LOADER_SETTLE_MS, useElapsed } from "@/components/ui/LoadingScreen";
import { signInFromHere } from "@/lib/sign-in-here";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useEffect, useReducer, type ReactNode } from "react";

interface ConnectionOverlayState {
  visible: boolean;
  fadeOut: boolean;
  hasConnected: boolean;
}

/** Connected but no Ready yet: stop covering the app after this long. */
const READY_FALLBACK_MS = 4000;

/**
 * The cold-load screen (ColdLoad) shown only on the first load, while the
 * gateway signs in, connects and becomes ready, and nothing is usable yet.
 * The mark resolves one stage per completed step and the status line
 * follows; it fades out once all three are done. Later drops never cover the app (talk-tree-spec §3 rule 4): the
 * connection strip (ConnectionBanner) shows them under the header.
 *
 * `children` is the app it covers: inert while the screen is up, so focus
 * and the screen reader cannot wander into a UI that is not there yet.
 */
export function ConnectionOverlay({
  initialHasConnected = false,
  children,
}: {
  /** Start as if a connection had already been made (fixtures, tests). */
  initialHasConnected?: boolean;
  children?: ReactNode;
} = {}) {
  const connected = useChatStore((s) => s.connected);
  const connectStep = useChatStore((s) => s.connectStep);
  const failure = useChatStore((s) => s.gatewayFailure);
  const online = useOnline();
  const slow = useElapsed(LOADER_SETTLE_MS);

  const [state, dispatch] = useReducer(
    (
      prev: ConnectionOverlayState,
      next: Partial<ConnectionOverlayState>,
    ): ConnectionOverlayState => ({ ...prev, ...next }),
    {
      // Ready has been seen before (connectStep stays 3 across a disconnect):
      // the store still holds the app's data, so coming back to /chat, a
      // route remount or a hot update is a reconnect, which the strip shows.
      // Only a store that never got there gets the cold load.
      visible: connectStep < 3 && !initialHasConnected,
      fadeOut: false,
      hasConnected: initialHasConnected || connectStep >= 3,
    },
  );
  const [readyTimedOut, setReadyTimedOut] = useReducer(() => true, false);

  // Connected but Ready never came: do not hold the app hostage.
  useEffect(() => {
    if (!connected || connectStep >= 3) return;
    const id = setTimeout(setReadyTimedOut, READY_FALLBACK_MS);
    return () => clearTimeout(id);
  }, [connected, connectStep]);

  const ready = connected && (connectStep >= 3 || readyTimedOut);

  useEffect(() => {
    if (!ready || !state.visible || state.fadeOut) return;
    const id = setTimeout(() =>
      dispatch({ hasConnected: true, fadeOut: true }),
    );
    return () => clearTimeout(id);
  }, [ready, state.visible, state.fadeOut]);

  // The exit holds "all three done" briefly, then fades (rm-loading-exit,
  // 1.2s); unmount when it ends.
  useEffect(() => {
    if (!state.fadeOut) return;
    const id = setTimeout(
      () => dispatch({ visible: false, fadeOut: false }),
      1200,
    );
    return () => clearTimeout(id);
  }, [state.fadeOut]);

  const covering = state.visible && !(state.hasConnected && !state.fadeOut);
  const step: ColdStep = state.fadeOut || ready ? 3 : connectStep;
  const error: ColdError =
    failure === "auth"
      ? "auth"
      : !online
        ? "offline"
        : slow && !ready
          ? "slow"
          : null;

  // No fade-in: the pending SplashScreen drew this same screen at step 0,
  // so the mark and status stay put. The exit fades the whole layer
  // (plate and backdrop) to reveal the app.
  // One stable tree in every state, so the app never remounts when the
  // screen comes or goes. Fading out reveals a live app: it takes input.
  return (
    <>
      {children === undefined ? null : (
        <div className="contents" inert={covering && !state.fadeOut}>
          {children}
        </div>
      )}
      {covering ? (
        <ColdLoadScreen
          step={step}
          error={error}
          onSignIn={signInFromHere}
          onReload={() => window.location.reload()}
          focusAction
          className={cn(
            "fixed inset-0 z-100",
            state.fadeOut && "rm-loading-exit",
          )}
        />
      ) : null}
    </>
  );
}
