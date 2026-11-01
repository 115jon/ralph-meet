import { useEffect, useState } from "react";
import { AppState } from "react-native";

import {
  loadCallPreferences,
  setCallPreference,
  useCallPreferences,
} from "@/features/preferences/call-preferences";
import { ConfirmSheet } from "@/ui";

import * as RalphCall from "../../../modules/ralph-call/src";
import { endIncoming, showIncoming, takeNativeAnswer } from "./actions";
import { IncomingCallSheet } from "./IncomingCallSheet";

/**
 * While signed in: the in-app ring sheet, the module's ring events, calls
 * answered outside the app (picked up at launch, on return to the front,
 * and live), and, once, the offer to allow calls over the lock screen
 * (Android 14+ makes full-screen notifications a permission the user
 * grants; without it a call only shows as a heads-up notification).
 */
export function CallsHost() {
  const [offerLockScreen, setOfferLockScreen] = useState(false);

  useEffect(() => {
    const subscriptions = [
      RalphCall.onIncomingCall(showIncoming),
      RalphCall.onIncomingCallEnded((end) => endIncoming(end.callId)),
      RalphCall.onIncomingCallAnswered(() => void takeNativeAnswer()),
    ];
    void takeNativeAnswer();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void takeNativeAnswer();
    });
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    if (!RalphCall.isAvailable) return;
    let live = true;
    void loadCallPreferences()
      .then(() =>
        useCallPreferences.getState().fullScreenOffered
          ? true
          : RalphCall.canUseFullScreenIntent(),
      )
      .then((fine) => {
        if (live && !fine) setOfferLockScreen(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <IncomingCallSheet />
      <ConfirmSheet
        request={
          offerLockScreen
            ? {
                kicker: "Incoming calls",
                title: "Ring on the lock screen",
                body: "Allow full-screen notifications so a call can wake your phone and show over the lock screen. Without it, calls only show as a notification.",
                confirm: "Open settings",
                onConfirm: () => void RalphCall.openFullScreenIntentSettings(),
              }
            : null
        }
        onClose={() => {
          setOfferLockScreen(false);
          setCallPreference("fullScreenOffered", true);
        }}
      />
    </>
  );
}
