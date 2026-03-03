import { useAuth, useClerk } from "@clerk/tanstack-react-start";
import { useNavigate } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Desktop-specific login page.
 *
 * Opens the system browser for OAuth sign-in (where the user is likely
 * already logged in). After authentication, the server generates a one-time
 * Clerk sign-in token and redirects back via deep link. The desktop app
 * then uses that token to establish a full Clerk session in the webview,
 * giving us both browser-based UX and native session management.
 */
export default function DesktopLogin() {
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const clerk = useClerk();
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();

  // If already signed in (session persisted by tauri-plugin-clerk), go to chat
  useEffect(() => {
    if (isSignedIn) {
      navigate({ to: "/chat/$", params: { _splat: "" }, replace: true });
    }
  }, [isSignedIn, navigate]);

  // Listen for deep link events carrying the sign-in ticket
  useEffect(() => {
    let cancelled = false;

    async function setupDeepLinkListener() {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        const handleDeepLink = async (payload: unknown) => {
          if (cancelled) return;
          // Check for auth ticket
          const ticket = extractTicket(payload);
          if (ticket) {
            await activateTicket(ticket);
            return;
          }
          // Check for invite deep link
          const inviteCode = extractInviteCode(payload);
          if (inviteCode) {
            navigate({ to: '/invite/$code', params: { code: inviteCode } } as any);
          }
        };

        const unlisten1 = await listen("deep-link", (event) => handleDeepLink(event.payload));
        const unlisten2 = await listen("deep-link://new-url", (event) => handleDeepLink(event.payload));

        return () => {
          cancelled = true;
          unlisten1();
          unlisten2();
        };
      } catch (e) {
        console.error("[DesktopLogin] Failed to set up deep link listener:", e);
        return undefined;
      }
    }

    const cleanup = setupDeepLinkListener();
    return () => {
      cleanup.then((fn) => fn?.());
    };
  }, []);

  /**
   * Use the sign-in ticket to establish a full Clerk session in the webview.
   * After this, tauri-plugin-clerk handles persistence and auto-refresh.
   */
  const activateTicket = useCallback(
    async (ticket: string) => {
      try {
        console.log("[DesktopLogin] Activating sign-in ticket...");
        const result = await clerk.client.signIn.create({
          strategy: "ticket",
          ticket,
        });

        if (result.createdSessionId) {
          await clerk.setActive({ session: result.createdSessionId });
          console.log("[DesktopLogin] Session established successfully");
          setStatus("idle");
          navigate({ to: "/chat/$", params: { _splat: "" }, replace: true });
        } else {
          console.error("[DesktopLogin] No session created from ticket");
          setStatus("error");
        }
      } catch (e: any) {
        // If already signed in (session persisted from previous run),
        // just navigate to chat — this is a success, not an error.
        if (e?.message?.includes("already signed in")) {
          console.log("[DesktopLogin] Already signed in, navigating to chat");
          setStatus("idle");
          navigate({ to: "/chat/$", params: { _splat: "" }, replace: true });
          return;
        }
        console.error("[DesktopLogin] Failed to activate ticket:", e);
        setStatus("error");
      }
    },
    [clerk, navigate]
  );

  const handleSignIn = useCallback(async () => {
    setStatus("waiting");
    try {
      const isDev = import.meta.env?.DEV === true;
      const authOrigin = isDev
        ? "http://localhost:5173"
        : "https://ralph-meet.jontitor.workers.dev";
      const signInUrl = `${authOrigin}/api/auth/desktop`;

      // Open in system browser (where user is already logged in)
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(signInUrl);
      } catch {
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
            Failed to sign in. Please try again.
          </p>
        )}
      </main>

      <footer className="absolute bottom-6 text-[0.6rem] font-bold tracking-widest uppercase text-rm-text-ghost">
        v0.1.0
      </footer>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract a sign-in ticket from various deep link payload formats.
 * Deep links arrive as ralphmeet://auth?ticket=<token>
 */
function extractTicket(payload: unknown): string | null {
  const url = extractDeepLinkUrl(payload);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("ticket");
  } catch {
    return null;
  }
}

/**
 * Extract an invite code from ralphmeet://invite/:code deep links.
 */
function extractInviteCode(payload: unknown): string | null {
  const url = extractDeepLinkUrl(payload);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    // ralphmeet://invite/abc123 → pathname is /abc123, hostname is invite
    if (parsed.hostname === "invite" && parsed.pathname) {
      return parsed.pathname.replace(/^\//, "") || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract a ralphmeet:// URL from various payload formats.
 */
function extractDeepLinkUrl(payload: unknown): string | null {
  if (!payload) return null;

  if (typeof payload === "string") {
    const cleaned = payload.replace(/^"|"$/g, "");
    if (cleaned.startsWith("ralphmeet://")) return cleaned;
    try {
      return extractDeepLinkUrl(JSON.parse(payload));
    } catch {
      return null;
    }
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractDeepLinkUrl(item);
      if (url) return url;
    }
    return null;
  }

  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (obj.urls) return extractDeepLinkUrl(obj.urls);
    if (obj.url) return extractDeepLinkUrl(obj.url);
  }

  return null;
}
