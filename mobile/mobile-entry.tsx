/**
 * Mobile SPA entry point.
 *
 * Shares routes/components with the web and desktop app. Auth is provided by
 * the shared React root via @ralph-auth/react.
 */
import "./styles.css";

import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routeTree } from "@/routeTree.gen";
import { invoke } from "@tauri-apps/api/core";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

void invoke("plugin:edge-to-edge|enable").catch(() => console.warn("Failed to enable edge-to-edge"));

void invoke<{ top: number; bottom: number; left: number; right: number }>("plugin:edge-to-edge|get_safe_area_insets")
  .then((insets) => {
    if (!insets) return;
    const style = document.documentElement.style;
    const computedBottom = Math.max(insets.bottom, 48);
    style.setProperty("--safe-area-top", `${insets.top}px`);
    style.setProperty("--safe-area-bottom", `${insets.bottom}px`);
    style.setProperty("--safe-area-bottom-computed", `${computedBottom}px`);
    style.setProperty("--safe-area-left", `${insets.left}px`);
    style.setProperty("--safe-area-right", `${insets.right}px`);
  })
  .catch(() => console.warn("Failed to query edge-to-edge insets"));

function MobileApp() {
  return (
    <StrictMode>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <div className="flex h-dvh w-full flex-col bg-rm-bg-primary">
          <Suspense fallback={<SplashScreen />}>
            <TooltipProvider delayDuration={200}>
              <RouterProvider router={router} />
            </TooltipProvider>
          </Suspense>
        </div>
      </ThemeProvider>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<MobileApp />);
}
