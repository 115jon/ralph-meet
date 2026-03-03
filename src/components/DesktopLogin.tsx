import { handleDeepLinkAuth, isDesktopAuthenticated } from "@/lib/desktop-auth";
import { useNavigate } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Desktop-specific login page.
 *
 * Instead of embedding Clerk's sign-in widget (which requires SSR),
 * this component opens the system browser for OAuth sign-in and then
 * captures the JWT via the ralphmeet://auth deep link callback.
 */
export function DesktopLogin() {
  const [status, setStatus] = useState<"idle" | "waiting" | "error">(
    "idle"
  );

  const navigate = useNavigate();

  // Listen for deep link auth events from the Tauri Rust layer
  useEffect(() => {
    const handleAuthChange = () => {
      if (isDesktopAuthenticated()) {
        // Redirect to chat once authenticated (client-side)
        navigate({ to: "/chat", replace: true });
      }
    };

    // Listen for the custom event dispatched by desktop-auth.ts
    window.addEventListener("desktop-auth-change", handleAuthChange);

    // Listen for deep link events forwarded from Tauri's Rust layer
    const handleDeepLink = (event: Event) => {
      const customEvent = event as CustomEvent;
      const payload = customEvent.detail;
      // Payload can be a string or JSON string containing the URL
      const url = typeof payload === "string" ? payload : JSON.stringify(payload);
      if (handleDeepLinkAuth(url)) {
        setStatus("idle");
      }
    };

    // Tauri emits this as a custom event on the window via the webview
    const tauriUnlisten = setupTauriDeepLinkListener(handleDeepLink);

    return () => {
      window.removeEventListener("desktop-auth-change", handleAuthChange);
      tauriUnlisten.then((fn) => fn?.());
    };
  }, []);

  // Check if already authenticated on mount
  useEffect(() => {
    if (isDesktopAuthenticated()) {
      window.location.pathname = "/chat";
    }
  }, []);

  const handleSignIn = useCallback(async () => {
    setStatus("waiting");
    try {
      // The auth endpoint lives on the web server (not the desktop SPA server).
      // In dev mode, the web server runs on localhost:5173.
      // In production, it's the deployed Workers origin.
      const isDev = import.meta.env?.DEV === true;
      const authOrigin = isDev
        ? "http://localhost:5173"
        : "https://ralph-meet.jontitor.workers.dev";
      const signInUrl = `${authOrigin}/api/auth/desktop`;

      // Use Tauri shell plugin to open in the system browser
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(signInUrl);
      } catch {
        // Fallback: open via window.open
        window.open(signInUrl, "_blank");
      }
    } catch (e) {
      console.error("[DesktopLogin] Failed to open browser:", e);
      setStatus("error");
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--rm-bg-primary)] px-6 select-none">
      {/* Subtle ambient glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          className="absolute h-[500px] w-[500px] rounded-full bg-indigo-500/8 blur-[100px]"
          style={{ top: "20%", left: "30%" }}
        />
        <div
          className="absolute h-[400px] w-[400px] rounded-full bg-purple-500/6 blur-[80px]"
          style={{ bottom: "20%", right: "25%" }}
        />
      </div>

      <main className="relative z-10 flex flex-col items-center gap-8 w-full max-w-[360px]">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-indigo-500/10 to-purple-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_0_40px_-10px_rgba(99,102,241,0.2)] ring-1 ring-white/10">
            <Radio className="h-8 w-8 text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            Ralph Meet
          </h1>
        </div>

        {/* Welcome text */}
        <div className="text-center space-y-2">
          <p className="text-[var(--rm-text-secondary)] text-sm leading-relaxed">
            Sign in to connect with your communities.
          </p>
        </div>

        {/* Sign In Button */}
        <button
          onClick={handleSignIn}
          disabled={status === "waiting"}
          className="w-full flex items-center justify-center gap-3 rounded-xl px-6 py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {status === "waiting" ? (
            <>
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Waiting for sign-in...
            </>
          ) : (
            "Sign in with your browser"
          )}
        </button>

        {status === "waiting" && (
          <p className="text-xs text-[var(--rm-text-muted)] text-center animate-pulse">
            Complete sign-in in your browser window.
            <br />
            You'll be redirected back automatically.
          </p>
        )}

        {status === "error" && (
          <p className="text-xs text-red-400 text-center">
            Failed to open browser. Please try again.
          </p>
        )}
      </main>

      <footer className="absolute bottom-6 text-[0.6rem] font-bold tracking-widest uppercase text-rm-text-ghost">
        v0.1.0
      </footer>
    </div>
  );
}

/**
 * Set up a listener for Tauri deep link events.
 * Returns a cleanup function.
 */
async function setupTauriDeepLinkListener(
  _callback: (event: Event) => void
): Promise<(() => void) | undefined> {
  try {
    const { listen } = await import("@tauri-apps/api/event");

    // Listen for our custom "deep-link" event emitted from Rust
    const unlisten1 = await listen("deep-link", (event) => {
      console.log("[DesktopLogin] deep-link event received:", JSON.stringify(event.payload));
      const url = extractDeepLinkUrl(event.payload);
      if (url) {
        console.log("[DesktopLogin] Extracted URL:", url);
        handleDeepLinkAuth(url);
      }
    });

    // Also listen for the deep-link plugin's own event
    const unlisten2 = await listen("deep-link://new-url", (event) => {
      console.log("[DesktopLogin] deep-link://new-url event received:", JSON.stringify(event.payload));
      const url = extractDeepLinkUrl(event.payload);
      if (url) {
        console.log("[DesktopLogin] Extracted URL from plugin:", url);
        handleDeepLinkAuth(url);
      }
    });

    return () => {
      unlisten1();
      unlisten2();
    };
  } catch (e) {
    console.error("[DesktopLogin] Failed to set up deep link listener:", e);
    return undefined;
  }
}

/**
 * Extract a ralphmeet:// URL from various payload formats.
 * Payloads may arrive as:
 *   - A string: "ralphmeet://auth?token=..."
 *   - A JSON-encoded string: "\"ralphmeet://auth?token=...\""
 *   - An array: ["ralphmeet://auth?token=..."]
 *   - A Tauri deep-link payload: { urls: ["ralphmeet://auth?token=..."] }
 */
function extractDeepLinkUrl(payload: unknown): string | null {
  if (!payload) return null;

  // Direct string
  if (typeof payload === "string") {
    const cleaned = payload.replace(/^"|"$/g, "");
    if (cleaned.startsWith("ralphmeet://")) return cleaned;
    // Try JSON parse
    try {
      return extractDeepLinkUrl(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  // Array of strings (common format)
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractDeepLinkUrl(item);
      if (url) return url;
    }
    return null;
  }

  // Object with urls array (deep-link plugin format)
  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (obj.urls) return extractDeepLinkUrl(obj.urls);
    if (obj.url) return extractDeepLinkUrl(obj.url);
  }

  return null;
}

export default DesktopLogin;
