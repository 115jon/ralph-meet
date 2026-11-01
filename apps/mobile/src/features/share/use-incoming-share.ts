import { router, useRootNavigationState } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useSession } from "@/features/auth/session";

import { payloadOf } from "./payload";
import { setPendingShare } from "./store";

const OPTIONS = {
  // A share waits for sign-in instead of being dropped when the app blinks.
  resetOnBackground: false,
  disabled: Platform.OS !== "android",
} as const;

/**
 * Photos, videos, text and links shared to Ralph from other apps (Android's
 * ACTION_SEND / SEND_MULTIPLE through expo-share-intent, which copies the
 * files into the cache): kept as the pending share, then the "Send to…"
 * picker opens over home once signed in.
 */
export function useIncomingShare(): void {
  const signedIn = useSession((s) => s.status === "signed-in");
  const navigationReady = useRootNavigationState()?.key !== undefined;
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntent(OPTIONS);

  useEffect(() => {
    if (!signedIn || !navigationReady || !hasShareIntent) return;
    const payload = payloadOf(shareIntent);
    resetShareIntent();
    if (!payload) return;
    setPendingShare(payload);
    router.push("/share");
  }, [
    signedIn,
    navigationReady,
    hasShareIntent,
    shareIntent,
    resetShareIntent,
  ]);
}
