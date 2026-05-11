
import { getDesktopToken } from "@/lib/desktop-auth";
import { isTauri } from "@/lib/platform";
import { useChatStore } from "@/stores/chat-store";
import { useAuth } from "@ralph-auth/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/**
 * Headless component that initializes and manages the
 * Chat WebSocket Gateway connection upon mount.
 *
 * Also handles invite deep links (ralphmeet://invite/:code)
 * when the user is already signed in.
 */
export function ChatGateway() {
  const { userId, isLoaded } = useAuth();
  const initGateway = useChatStore(s => s.gateway.initGateway);
  const setClerkUserId = useChatStore(s => s.gateway.setClerkUserId);
  const disconnectGateway = useChatStore(s => s.gateway.disconnectGateway);
  const navigate = useNavigate();

  const tokenReady = isLoaded || !!getDesktopToken();

  const disconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Wait for the token to be synced before initialising the gateway
    if (!tokenReady) return;

    // If there was a pending disconnect from a strict-mode unmount, cancel it.
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }

    initGateway(userId);

    return () => {
      // In React 18 strict mode, components unmount and remount immediately.
      // We delay the actual disconnect slightly so that if the component remounts
      // within that window, we preserve the active WebSocket session.
      disconnectTimeoutRef.current = setTimeout(() => {
        disconnectGateway();
      }, 500);
    };
  }, [initGateway, disconnectGateway, userId, tokenReady]);

  useEffect(() => {
    useChatStore.getState().gateway.setClerkUserId(userId);
  }, [userId]);

  // Listen for invite deep links while the user is signed in (desktop only)
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    async function listenForInvites() {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        const handler = (event: any) => {
          if (cancelled) return;
          const code = extractInviteCode(event.payload);
          if (code) {
            navigate({ to: '/invite/$code', params: { code } } as any);
          }
        };

        const u1 = await listen("deep-link", handler);
        const u2 = await listen("deep-link://new-url", handler);
        return () => { cancelled = true; u1(); u2(); };
      } catch {
        return undefined;
      }
    }

    const cleanup = listenForInvites();
    return () => { cleanup.then((fn) => fn?.()); };
  }, [navigate]);

  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (obj.urls) return extractDeepLinkUrl(obj.urls);
    if (obj.url) return extractDeepLinkUrl(obj.url);
  }

  return null;
}
