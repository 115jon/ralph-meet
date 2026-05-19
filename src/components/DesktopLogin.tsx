import { SplashScreen } from "@/components/SplashScreen";
import { clearDesktopAuthSession, setDesktopAuthSession, waitForDesktopToken } from "@/lib/desktop-auth";
import { apiUrl, getPublicWebUrl, isMobile } from "@/lib/platform";
import { getRalphAuthUrl, RALPH_AUTH_PUBLISHABLE_KEY } from "@/lib/ralph-auth-config";
import { useAuth } from "@ralph-auth/react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SafeAreaView } from "./ui/safe-area-view";

/**
 * Desktop/mobile login page.
 *
 * Opens the system browser for hosted Ralph Auth sign-in. On success, Ralph Auth
 * returns to ralphmeet://auth with an app-scoped exchange code that this webview
 * swaps for a persisted Ralph Meet session token.
 */
export default function DesktopLogin() {
  const [status, setStatus] = useState<"resolving" | "idle" | "waiting" | "error">("resolving");
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function resolveExistingDesktopSession() {
      const token = await waitForDesktopToken(1800);
      if (cancelled) return;
      if (token) {
        const valid = await validateDesktopSession(token);
        if (cancelled) return;
        if (valid) {
          navigate({ to: "/chat", replace: true });
        } else {
          clearDesktopAuthSession();
          setStatus("idle");
        }
        return;
      }
      setStatus((current) => (current === "resolving" ? "idle" : current));
    }

    void resolveExistingDesktopSession();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const completeDesktopLogin = useCallback(
    async (sessionToken: string) => {
      setDesktopAuthSession(sessionToken);
      const valid = await validateDesktopSession(sessionToken);
      if (!valid) {
        console.warn("[DesktopLogin] Desktop session token was rejected by API");
        clearDesktopAuthSession();
        setStatus("error");
        return;
      }

      setStatus("idle");
      navigate({ to: "/chat", replace: true });
    },
    [navigate],
  );

  const activateCode = useCallback(
    async (code: string) => {
      try {
        if (!RALPH_AUTH_PUBLISHABLE_KEY) {
          console.error("[DesktopLogin] Missing VITE_RALPH_AUTH_PUBLISHABLE_KEY");
          setStatus("error");
          return;
        }

        const response = await fetch(
          `${getRalphAuthUrl()}/api/pub/apps/${RALPH_AUTH_PUBLISHABLE_KEY}/exchange-code`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          },
        );

        if (!response.ok) {
          throw new Error(`Exchange failed: ${response.status}`);
        }

        const payload = (await response.json()) as { sessionToken?: string };
        if (!payload.sessionToken) {
          throw new Error("Exchange did not return a session token");
        }

        await completeDesktopLogin(payload.sessionToken);
      } catch (e) {
        console.error("[DesktopLogin] Failed to exchange auth code:", e);
        setStatus("error");
      }
    },
    [completeDesktopLogin],
  );

  useEffect(() => {
    let cancelled = false;

    async function setupDeepLinkListener() {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        const handleDeepLink = async (payload: unknown) => {
          if (cancelled) return;

          const authCode = extractAuthCode(payload);
          if (authCode) {
            await activateCode(authCode);
            return;
          }

          const sessionToken = extractSessionToken(payload);
          if (sessionToken) {
            await completeDesktopLogin(sessionToken);
            return;
          }

          const inviteCode = extractInviteCode(payload);
          if (inviteCode) {
            navigate({ to: "/invite/$code", params: { code: inviteCode } } as any);
          }
        };

        const unlisten1 = await listen("deep-link", (event) => handleDeepLink(event.payload));
        const unlisten2 = await listen("deep-link://new-url", (event) => handleDeepLink(event.payload));

        return () => {
          cancelled = true;
          try {
            if (typeof unlisten1 === "function") unlisten1();
            if (typeof unlisten2 === "function") unlisten2();
          } catch (e) {
            console.error("[DesktopLogin] Failed to unlisten:", e);
          }
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
  }, [activateCode, completeDesktopLogin, navigate]);

  const handleSignIn = useCallback(async () => {
    setStatus("waiting");
    try {
      const signIn = new URL("/sign-in", getPublicWebUrl());
      signIn.searchParams.set("redirect_url", "ralphmeet://auth");
      signIn.searchParams.set("native_handoff", "1");
      const signInUrl = signIn.toString();

      if (isMobile()) {
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(signInUrl);
          return;
        } catch (err) {
          console.warn("[DesktopLogin] Tauri plugin-opener failed on mobile, falling back to window.location", err);
          window.location.href = signInUrl;
          return;
        }
      }

      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(signInUrl);
      } catch (err) {
        console.warn("[DesktopLogin] Tauri plugin-opener failed, falling back to window.open", err);
        window.open(signInUrl, "_blank");
      }
    } catch (e) {
      console.error("[DesktopLogin] Failed to open browser:", e);
      setStatus("error");
    }
  }, []);

  if (status === "idle" && isSignedIn) {
    return <Navigate to="/" replace />;
  }

  if (status === "resolving") {
    return <SplashScreen />;
  }

  return (
    <SafeAreaView className="flex h-full flex-col items-center justify-center bg-rm-bg-primary px-6 select-none border-0">
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
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-linear-to-br from-indigo-500/10 to-purple-500/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_0_40px_-10px_rgba(99,102,241,0.2)] ring-1 ring-white/10">
            <Radio className="h-8 w-8 text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
          </div>
          <h1 className="bg-linear-to-b from-white to-white/70 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            Ralph Meet
          </h1>
        </div>

        <div className="text-center space-y-2">
          <p className="text-rm-text-secondary text-sm leading-relaxed">
            Sign in to connect with your communities.
          </p>
        </div>

        <button
          onClick={handleSignIn}
          disabled={status === "waiting"}
          className="w-full flex items-center justify-center gap-3 rounded-xl px-6 py-3.5 text-sm font-semibold text-white bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {status === "waiting" ? "Waiting for sign-in..." : "Sign in with your browser"}
        </button>

        {status === "waiting" && (
          <p className="text-xs text-rm-text-muted text-center animate-pulse">
            Complete sign-in in your browser window.
            <br />
            You&apos;ll be redirected back automatically.
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
    </SafeAreaView>
  );
}

function extractAuthCode(payload: unknown): string | null {
  const url = extractDeepLinkUrl(payload);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("ralph_auth_code") ?? parsed.searchParams.get("code");
  } catch {
    return null;
  }
}

function extractSessionToken(payload: unknown): string | null {
  const url = extractDeepLinkUrl(payload);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("session_token");
  } catch {
    return null;
  }
}

function extractInviteCode(payload: unknown): string | null {
  const url = extractDeepLinkUrl(payload);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === "invite" && parsed.pathname) {
      return parsed.pathname.replace(/^\//, "") || null;
    }
    return null;
  } catch {
    return null;
  }
}

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

  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (obj.urls) return extractDeepLinkUrl(obj.urls);
    if (obj.url) return extractDeepLinkUrl(obj.url);
  }

  return null;
}

async function validateDesktopSession(sessionToken: string): Promise<boolean> {
  try {
    const response = await fetch(apiUrl("/api/users/me"), {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Publishable-Key": RALPH_AUTH_PUBLISHABLE_KEY,
      },
    });
    return response.ok;
  } catch (error) {
    console.warn("[DesktopLogin] Failed to validate desktop session:", error);
    return false;
  }
}
