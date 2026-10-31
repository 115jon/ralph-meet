import { SplashScreen } from "@/components/SplashScreen";
import { lazy, Suspense } from "react";

// The desktop sign-in screen is only ever drawn inside the Tauri shell. The
// web build keeps it out of the landing, sign-in and sign-up chunks.
const DesktopLogin = lazy(() => import("@/components/DesktopLogin"));

export function LazyDesktopLogin() {
  return (
    <Suspense fallback={<SplashScreen />}>
      <DesktopLogin />
    </Suspense>
  );
}
