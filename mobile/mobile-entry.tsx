/**
 * Mobile SPA entry point.
 *
 * Shares routes/components with the web and desktop app. Auth is provided by
 * the shared React root via @kova/react.
 */
import "./styles.css";

import { SplashScreen } from "@/components/SplashScreen";
import { setupSafeArea } from "@/lib/safe-area";
import { routeTree } from "@/routeTree.gen";
import { invoke } from "@tauri-apps/api/core";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense, useEffect } from "react";
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

function MobileApp() {
  useEffect(() => setupSafeArea(invoke, document, window), []);

  return (
    <StrictMode>
      <Suspense fallback={<SplashScreen />}>
        <RouterProvider router={router} />
      </Suspense>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<MobileApp />);
}
