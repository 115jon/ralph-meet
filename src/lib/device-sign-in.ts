/**
 * Single seam for Kova device-code sign-in (desktop + mobile shells).
 *
 * Everything in the app goes through this module so the SDK import lives in
 * exactly one place and tests can mock it with one `vi.mock`.
 */
import {
  startDeviceSignIn,
  type DeviceSignIn as DeviceSignInController,
  type DeviceSignInOptions,
  type DeviceSignInState,
} from "@kova/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isMobile, isWindows } from "@/lib/platform";

export { startDeviceSignIn };
export type { DeviceSignInController, DeviceSignInOptions, DeviceSignInState };
export type DeviceInfo = NonNullable<DeviceSignInOptions["device"]>;

export type DevicePlatform = "windows" | "macos" | "linux" | "android" | "ios";

/** Best-effort OS name for the device-approval screen. */
export function getDevicePlatform(): DevicePlatform | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent || "";
  // Android/iOS checks come first: their UAs also mention Linux / Mac OS.
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (isMobile() && /macintosh/i.test(ua) && navigator.maxTouchPoints > 1) {
    return "ios"; // iPadOS reports a desktop Safari UA
  }
  if (isWindows()) return "windows";
  if (/mac os|macintosh/i.test(ua)) return "macos";
  if (/linux|x11/i.test(ua)) return "linux";
  return undefined;
}

export function getDeviceInfo(): DeviceInfo {
  const platform = getDevicePlatform();
  return {
    ...(platform ? { platform } : {}),
    label: isMobile() ? "Ralph Meet Mobile" : "Ralph Meet Desktop",
  };
}

export type DeviceSignInHookState = { status: "idle" } | DeviceSignInState;

export type UseDeviceSignInOptions = {
  authUrl: string;
  publishableKey: string;
  device?: DeviceInfo;
};

/**
 * Owns one device sign-in controller at a time.
 *
 * - `start()` cancels any previous attempt and begins a new one.
 * - `cancel()` stops polling and returns to idle.
 * - The controller is cancelled on unmount.
 * - While pending, window focus / tab becoming visible calls `nudge()` so the
 *   next poll happens immediately when the user returns from the browser.
 */
export function useDeviceSignIn(options: UseDeviceSignInOptions) {
  const [state, setState] = useState<DeviceSignInHookState>({
    status: "idle",
  });
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const controllerRef = useRef<DeviceSignInController | null>(null);
  // Bumped on every start/cancel so late events from an old controller are ignored.
  const generationRef = useRef(0);

  const start = useCallback(() => {
    controllerRef.current?.cancel();
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;

    setState({ status: "starting" });
    const { authUrl, publishableKey, device } = optionsRef.current;
    let controller: DeviceSignInController;
    try {
      controller = startDeviceSignIn({
        authUrl,
        publishableKey,
        device,
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

  const nudge = useCallback(() => {
    controllerRef.current?.nudge();
  }, []);

  useEffect(() => {
    return () => {
      // generationRef is a counter, not a DOM ref; reading it at cleanup is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generationRef.current++;
      controllerRef.current?.cancel();
      controllerRef.current = null;
    };
  }, []);

  const isPending = state.status === "pending";
  useEffect(() => {
    if (!isPending || typeof window === "undefined") return;
    const onFocus = () => nudge();
    const onVisibility = () => {
      if (document.visibilityState === "visible") nudge();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isPending, nudge]);

  return { state, start, cancel, nudge };
}
