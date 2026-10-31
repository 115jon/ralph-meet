import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useSession } from "@/features/auth/session";
import { useCurrentUser } from "@/features/auth/use-current-user";
import { FONT_ASSETS, ThemeProvider, useTheme } from "@/theme";

void SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const theme = useTheme();
  const signedIn = useSession((s) => s.status === "signed-in");
  useCurrentUser();
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
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const sessionReady = useSession((s) => s.status !== "loading");
  const ready = (fontsLoaded || fontError !== null) && sessionReady;

  useEffect(() => {
    void useSession.getState().hydrate();
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
