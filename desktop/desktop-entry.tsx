/**
 * Desktop SPA entry point.
 *
 * This bypasses TanStack Start's SSR and mounts the shared React app as a
 * client-only SPA in the Tauri webview.
 */
import "./styles.css";

import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateChecker } from "@/components/UpdateChecker";
import { routeTree } from "@/routeTree.gen";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StandaloneUpdater } from "@/components/StandaloneUpdater";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function DesktopApp() {
  const win = getCurrentWindow();
  console.info(`[DesktopApp] Mount. Window label is: ${win.label}`);
  const isUpdater = win.label === "updater";

  return (
    <StrictMode>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={200}>
          {isUpdater ? (
            <StandaloneUpdater />
          ) : (
            <Suspense fallback={<SplashScreen />}>
              <>
                <RouterProvider router={router} />
                <UpdateChecker />
              </>
            </Suspense>
          )}
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<DesktopApp />);
}
