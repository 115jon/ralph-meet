import { openBrowserAsync } from "expo-web-browser";
import { useEffect } from "react";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/features/auth/session";
import {
  useDeviceSignIn,
  type DeviceSignInHookState,
} from "@/features/auth/use-device-sign-in";
import { useTheme } from "@/theme";
import { Button, Led, Text, type LedState } from "@/ui";

interface Status {
  led: LedState;
  line: string;
}

/** One line and LED per state; the switch is exhaustive on purpose. */
function statusOf(state: DeviceSignInHookState): Status {
  switch (state.status) {
    case "idle":
      return { led: "off", line: "Ready when you are" };
    case "starting":
      return { led: "live", line: "Getting a code" };
    case "pending":
      return { led: "live", line: "Waiting for approval" };
    case "approved":
      return { led: "talk", line: "Approved, signing in" };
    case "denied":
      return { led: "danger", line: "Denied from the browser" };
    case "expired":
      return { led: "idle", line: "That code expired" };
    case "cancelled":
      return { led: "off", line: "Cancelled" };
    case "error":
      return { led: "danger", line: state.error };
  }
}

function openApprovalPage(url: string) {
  openBrowserAsync(url).catch(() => Linking.openURL(url));
}

export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { state, start, cancel } = useDeviceSignIn();

  // A fresh code as soon as the screen opens.
  useEffect(() => {
    start();
  }, [start]);

  // Signing in flips the Stack.Protected guards, which route to the tabs.
  const sessionToken = state.status === "approved" ? state.sessionToken : null;
  useEffect(() => {
    if (sessionToken) void useSession.getState().signIn(sessionToken);
  }, [sessionToken]);

  const { led, line } = statusOf(state);
  const retry =
    state.status === "error"
      ? state.retryable
      : state.status === "denied" ||
        state.status === "expired" ||
        state.status === "idle" ||
        state.status === "cancelled";

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.ply0,
        paddingTop: insets.top + 48,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
        gap: 24,
      }}
    >
      <View style={{ gap: 8 }}>
        <Text variant="display">Ralph Meet</Text>
        <Text variant="body" tone="ink2">
          Approve this phone from a browser where you are already signed in.
        </Text>
      </View>

      <View
        style={{
          gap: 8,
          padding: 16,
          borderWidth: 1,
          borderColor: theme.line,
          backgroundColor: theme.ply1,
        }}
      >
        <Text variant="silk" tone="ink3">
          Device code
        </Text>
        <Text
          variant="num"
          tone={state.status === "pending" ? "ink1" : "inkOff"}
          style={{ fontSize: 32, lineHeight: 40, letterSpacing: 2 }}
          selectable
        >
          {state.status === "pending" ? state.userCode : "----"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Led state={led} />
        <Text variant="row" tone="ink2" style={{ flex: 1 }}>
          {line}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        {state.status === "pending" ? (
          <>
            <Button
              label="Open approval page"
              onPress={() => openApprovalPage(state.verificationUriComplete)}
            />
            <Button variant="ghost" label="Cancel" onPress={cancel} />
          </>
        ) : retry ? (
          <Button
            label={
              state.status === "error" || state.status === "idle"
                ? "Retry"
                : "Get a new code"
            }
            onPress={start}
          />
        ) : null}
      </View>
    </View>
  );
}
