import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useSession } from "@/features/auth/session";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { ImageViewer } from "@/features/media/ImageViewer";
import { ProfileHost } from "@/features/profile/ProfileHost";
import { loadCallPreferences } from "@/features/preferences/call-preferences";
import { configurePush } from "@/features/push/push";
import { useNativeNotifications } from "@/features/push/use-native-notifications";
import { usePush } from "@/features/push/use-push";
import { useRealtime } from "@/features/realtime/use-realtime";
import { useIncomingShare } from "@/features/share/use-incoming-share";
import { FONT_ASSETS, ThemeProvider, useTheme } from "@/theme";
import { ToastHost } from "@/ui";

void SplashScreen.preventAutoHideAsync();
configurePush();

function ThemedStack() {
  const theme = useTheme();
  const signedIn = useSession((s) => s.status === "signed-in");
  useCurrentUser();
  useRealtime();
  usePush();
  useNativeNotifications();
  useIncomingShare();
  return (
    <>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.ply0 },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="home" />
          {/* Links into home's pager: they hand over and close at once. */}
          <Stack.Screen name="channel/[id]" options={{ animation: "none" }} />
          <Stack.Screen name="dm/[id]" options={{ animation: "none" }} />
          <Stack.Screen name="activity" />
          <Stack.Screen
            name="invite/[code]"
            options={{ animation: "slide_from_bottom" }}
          />
          <Stack.Screen
            name="share"
            options={{ animation: "slide_from_bottom" }}
          />
          <Stack.Screen name="settings" />
          <Stack.Screen
            name="call"
            options={{ animation: "slide_from_bottom" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
      {signedIn ? <ProfileHost /> : null}
      <ImageViewer />
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const sessionReady = useSession((s) => s.status !== "loading");
  const ready = (fontsLoaded || fontError !== null) && sessionReady;

  useEffect(() => {
    void useSession.getState().hydrate();
    void loadCallPreferences();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ThemedStack />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
