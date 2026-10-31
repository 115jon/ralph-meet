/**
 * React Native port of the web hook (src/lib/device-sign-in.ts): same
 * generation/cancel semantics, nudging on app foreground instead of window
 * focus. The `/device` entry is the SDK's React-free, fetch-only subpath.
 */
import {
  startDeviceSignIn,
  type DeviceSignIn as DeviceSignInController,
  type DeviceSignInState,
} from "@kova/react/device";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { config } from "@/lib/config";

export type { DeviceSignInState };
export type DeviceSignInHookState = { status: "idle" } | DeviceSignInState;

const isIos = Platform.OS === "ios";
const DEVICE = {
  platform: isIos ? "ios" : "android",
  label: isIos ? "Ralph Meet iOS" : "Ralph Meet Android",
};

/**
 * Owns one device sign-in controller at a time.
 *
 * - `start()` cancels any previous attempt and begins a new one.
 * - `cancel()` stops polling and returns to idle.
 * - The controller is cancelled on unmount.
 * - While pending, the app returning to the foreground calls `nudge()` so
 *   the next poll happens at once when the user comes back from the browser.
 */
export function useDeviceSignIn() {
  const [state, setState] = useState<DeviceSignInHookState>({
    status: "idle",
  });
  const controllerRef = useRef<DeviceSignInController | null>(null);
  // Bumped on every start/cancel so late events from an old controller are ignored.
  const generationRef = useRef(0);

  const start = useCallback(() => {
    controllerRef.current?.cancel();
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;

    setState({ status: "starting" });
    let controller: DeviceSignInController;
    try {
      controller = startDeviceSignIn({
        authUrl: config.kovaAuthUrl,
        publishableKey: config.kovaPublishableKey,
        device: DEVICE,
        onChange: (next) => {
          if (isCurrent()) setState(next);
        },
      });
    } catch (error) {
      controllerRef.current = null;
      setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
      return;
    }

    controllerRef.current = controller;
    setState(controller.state);
    controller.done.then(
      (final) => {
        if (isCurrent()) setState(final);
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
      },
    );
  }, []);

  const cancel = useCallback(() => {
    generationRef.current++;
    controllerRef.current?.cancel();
    controllerRef.current = null;
    setState({ status: "idle" });
  }, []);

  useEffect(() => {
    const generation = generationRef;
    const controller = controllerRef;
    return () => {
      generation.current++;
      controller.current?.cancel();
      controller.current = null;
    };
  }, []);

  const isPending = state.status === "pending";
  useEffect(() => {
    if (!isPending) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") controllerRef.current?.nudge();
    });
    return () => subscription.remove();
  }, [isPending]);

  return { state, start, cancel };
}
