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

import { SplashScreen } from "@/components/SplashScreen";
import { ThemeProvider } from "@/components/theme-provider";

// --- DEBUG LOGGER OVERLAY ---
const createLogger = () => {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.8); color: #0f0; z-index: 999999;
    font-family: monospace; font-size: 12px; padding: 20px;
    overflow-y: auto; pointer-events: none; white-space: pre-wrap;
  `;
  document.body.appendChild(overlay);

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const append = (prefix: string, color: string, ...args: any[]) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a, Object.getOwnPropertyNames(a)) : String(a))).join(" ");
    const line = document.createElement("div");
    line.style.color = color;
    line.textContent = `[${prefix}] ${msg}`;
    overlay.appendChild(line);
    overlay.scrollTop = overlay.scrollHeight;
  };

  console.log = (...args) => { originalLog(...args); append("LOG", "#0f0", ...args); };
  console.warn = (...args) => { originalWarn(...args); append("WRN", "#ff0", ...args); };
  console.error = (...args) => { originalError(...args); append("ERR", "#f00", ...args); };

  window.addEventListener("error", (e) => console.error("Uncaught Error:", e.error, e.message, e.filename, e.lineno));
  window.addEventListener("unhandledrejection", (e) => console.error("Unhandled Rejection:", e.reason));

  // Toggle overlay with Ctrl+Shift+L
  overlay.style.display = "none";
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
      overlay.style.display = overlay.style.display === "none" ? "block" : "none";
    }
  });
};
createLogger(); // Always enable for this debugging session
// ----------------------------


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
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ClerkProvider>
  );
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
        <Suspense fallback={<SplashScreen />}>
          <DesktopAppWithClerk clerkPromise={clerkPromise} />
        </Suspense>
      </ThemeProvider>
    </StrictMode>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<DesktopApp />);
}
