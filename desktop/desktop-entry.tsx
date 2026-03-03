/**
 * Desktop SPA entry point.
 *
 * This bypasses TanStack Start's SSR entirely and mounts the React app
 * as a client-only SPA in the Tauri webview. Routes, components, and
 * stores are shared with the web app — only the bootstrap differs.
 */
import "./styles.css";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routeTree } from "@/routeTree.gen";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

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

function DesktopApp() {
  return (
    <StrictMode>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={200}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<DesktopApp />);
}
