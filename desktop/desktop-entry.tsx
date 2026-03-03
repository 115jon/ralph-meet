/**
 * Desktop SPA entry point.
 *
 * This bypasses TanStack Start's SSR entirely and mounts the React app
 * as a client-only SPA in the Tauri webview. Routes, components, and
 * stores are shared with the web app — only the bootstrap differs.
 *
 * Clerk is initialised via tauri-plugin-clerk which patches globalThis.fetch
 * to route Clerk API calls through Rust, avoiding cookie/Origin issues.
 */
import "./styles.css";

import { ThemeProvider } from "@/components/theme-provider";
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
const clerkPromise = initClerk();

/**
 * Inner component that resolves the Clerk promise and wraps the app
 * in a real ClerkProvider with the Tauri-managed Clerk instance.
 */
function DesktopAppWithClerk({ clerkPromise }: { clerkPromise: Promise<Clerk> }) {
  const clerk = use(clerkPromise);
  return (
    <ClerkProvider publishableKey={clerk.publishableKey} Clerk={clerk}>
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
    </ClerkProvider>
  );
}

function DesktopApp() {
  return (
    <StrictMode>
      <Suspense fallback={
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#111",
          color: "#888",
          fontFamily: "Figtree, sans-serif",
        }}>
          Loading...
        </div>
      }>
        <DesktopAppWithClerk clerkPromise={clerkPromise} />
      </Suspense>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<DesktopApp />);
}
