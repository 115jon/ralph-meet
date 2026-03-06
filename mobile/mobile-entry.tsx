/**
 * Mobile SPA entry point.
 *
 * Same as desktop-entry.tsx but without desktop-specific features:
 * - No system tray integration
 * - No screen capture picker
 * - No window state management
 * - No autostart
 *
 * Uses the same shared components, stores, and routes from ../src/.
 */

// ⚠️ CRITICAL: Install fetch interceptor BEFORE any other imports.
// @clerk/clerk-js captures `globalThis.fetch` at module load time,
// so our interceptor must be in place before that module evaluates.
// Routes Clerk FAPI calls through the Rust-side fapi_proxy command.
import { installFetchInterceptor } from "./patch-mobile-fetch";
installFetchInterceptor();

import "./styles.css";

// Safe area insets (--safe-area-inset-top/bottom/left/right) are injected
// directly from MainActivity.kt via WindowInsetsCompat → evaluateJavascript.
// No JS plugin needed — the Kotlin approach is more reliable on Android.

import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routeTree } from "@/routeTree.gen";
import type { Clerk } from "@clerk/clerk-js";
import { ClerkProvider } from "@clerk/clerk-react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense, use } from "react";
import { createRoot } from "react-dom/client";
import { initClerk } from "tauri-plugin-clerk";

// Create client-only router (no server functions, no SSR)
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// Augment module for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Initialize Clerk — this loads the persisted session from tauri-plugin-store
// and patches globalThis.fetch for Clerk API calls.
// The fetch interceptor (installed above) automatically wraps the patched fetch
// to strip x-tauri-fetch and Origin headers, preventing the Android header
// collision that causes Clerk's FAPI to reject native auth requests.
const clerkPromise = initClerk();

// Try to fetch manual safe areas because WebView load races with Edge-to-Edge auto injection
import { invoke } from "@tauri-apps/api/core";
void invoke<{ top: number; bottom: number; left: number; right: number }>("plugin:edge-to-edge|get_safe_area_insets")
  .then((insets) => {
    if (insets) {
      const style = document.documentElement.style;
      const computedBottom = Math.max(insets.bottom, 48);
      style.setProperty("--safe-area-top", `${insets.top}px`);
      style.setProperty("--safe-area-inset-top", `${insets.top}px`);
      style.setProperty("--safe-area-bottom", `${insets.bottom}px`);
      style.setProperty("--safe-area-inset-bottom", `${insets.bottom}px`);
      style.setProperty("--safe-area-bottom-computed", `${computedBottom}px`);
      style.setProperty("--safe-area-left", `${insets.left}px`);
      style.setProperty("--safe-area-right", `${insets.right}px`);
      style.setProperty("--safe-area-inset-left", `${insets.left}px`);
      style.setProperty("--safe-area-inset-right", `${insets.right}px`);
      console.log("Mobile app safe area manually restored:", insets);
    }
  })
  .catch(() => console.warn("Failed to query edge-to-edge insets"));

/**
 * Inner component that resolves the Clerk promise and wraps the app
 * in a real ClerkProvider with the Tauri-managed Clerk instance.
 */
function MobileAppWithClerk({ clerkPromise }: { clerkPromise: Promise<Clerk> }) {
  const clerk = use(clerkPromise);
  return (
    <ClerkProvider publishableKey={clerk.publishableKey} Clerk={clerk}>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ClerkProvider>
  );
}

function MobileApp() {
  return (
    <StrictMode>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <SafeAreaView className="bg-[var(--rm-bg-primary)]">
          <Suspense fallback={<SplashScreen />}>
            <MobileAppWithClerk clerkPromise={clerkPromise} />
          </Suspense>
        </SafeAreaView>
      </ThemeProvider>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<MobileApp />);
}
