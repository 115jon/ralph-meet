/**
 * Dev-only fixtures for the auth and public pages ("pub-*" surfaces, see
 * routes/ui-fixtures.tsx). Each mounts the real component with injected deps
 * or a stubbed fetch. Nothing here ships.
 *
 *   pub-activate-{enter,enter-error,auth-loading,loading,review,review-long,
 *     deny-busy,decide-error,approved,expired,rate-limited,mfa,network}
 *   pub-sign-in-device    sign-in reached from /activate (device waiting)
 *   pub-desktop-{idle,starting,pending,expiring,open-failed,verifying,
 *     rejected,unreachable,denied,expired,error,mfa}
 *   pub-invite-{loading,preview,signed-out,joining,joined,signin,
 *     invalid,expired,member,error}
 *   pub-share-{loaded,edited,loading,gone,error}
 *   pub-route-error | pub-404
 */

import { AUTH_CARD_APPEARANCE } from "@/components/auth/auth-card-appearance";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import {
  DeviceActivation,
  type ActivationDeps,
} from "@/components/auth/DeviceActivation";
import { DeviceWaitingNotice } from "@/components/auth/DeviceWaitingNotice";
import InviteClient, {
  type InvitePreview,
} from "@/components/chat/InviteClient";
import SharedMessagePage, {
  type PublicShare,
} from "@/components/chat/SharedMessagePage";
import { DeviceSignInScreen } from "@/components/DesktopLogin";
import { NotFoundPage, RouteErrorPage } from "@/components/PageState";
import {
  clearStoredKovaAuthSessionToken,
  setStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import type { DeviceSignInHookState } from "@/lib/device-sign-in";
import { useFixtureSetup } from "@/components/dev/sp-fixtures/api-stub";
import { SignIn } from "@kova/react";
import { useEffect, useState, type ReactNode } from "react";

// ── shared helpers ───────────────────────────────────────────────────────────

const never = <T,>() => new Promise<T>(() => {});

/** Clicks the first button whose text matches, once, after mount. */
function useAutoClick(label: string | null, delay = 300) {
  useEffect(() => {
    if (!label) return;
    const t = window.setTimeout(() => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (el) => el.textContent?.trim() === label,
      );
      button?.click();
    }, delay);
    return () => window.clearTimeout(t);
  }, [label, delay]);
}

/** Installs a fetch stub before children mount; restores it on unmount. */
function useFetchStub(
  handler: (url: string, init?: RequestInit) => Promise<Response> | null,
) {
  useState(() => {
    const real = window.fetch.bind(window);
    (window as { __realFetch?: typeof fetch }).__realFetch ??= real;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return handler(url, init) ?? real(input, init);
    }) as typeof fetch;
    return true;
  });
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

// ── /activate ────────────────────────────────────────────────────────────────

const REQUEST = {
  userCode: "KDRW-7QXN",
  status: "pending" as const,
  device: {
    label: "Ralph Meet Desktop",
    platform: "win32",
    hostname: "ada-workstation",
  },
  requester: { city: "Nashville", country: "US", ip: "203.0.113.7" },
  expiresAt: null,
};

const LONG_REQUEST = {
  ...REQUEST,
  device: {
    label: "Ralph Meet Desktop (Beta channel, auto-updates on)",
    platform: "darwin",
    hostname: "adas-extremely-long-macbook-pro-hostname.local",
  },
  requester: {
    city: "Llanfairpwllgwyngyll",
    country: "GB",
    ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
  },
};

function activationDeps(
  surface: string,
  overrides: Partial<ActivationDeps["approval"]> = {},
): ActivationDeps {
  const long = surface === "pub-activate-review-long";
  return {
    auth: {
      isLoaded: surface !== "pub-activate-auth-loading",
      isSignedIn: true,
      signOut: async () => {},
    },
    user: {
      id: "u1",
      name: long ? "Augusta Ada King, Countess of Lovelace" : "Ada Lovelace",
      email: long
        ? "augusta.ada.king.countess.of.lovelace@analytical-engine.example"
        : "ada@example.com",
      image: long ? "https://invalid.example/broken.png" : null,
    } as ActivationDeps["user"],
    approval: {
      isReady: true,
      getDeviceRequest: async () => ({
        ok: true as const,
        request: long ? LONG_REQUEST : REQUEST,
      }),
      approveDeviceRequest: async () => ({
        ok: true as const,
        status: "approved" as const,
      }),
      denyDeviceRequest: async () => ({
        ok: true as const,
        status: "denied" as const,
      }),
      releaseDeviceRequest: async () => ({
        ok: true as const,
        status: "released" as const,
      }),
      ...overrides,
    } as unknown as ActivationDeps["approval"],
  };
}

function ActivateFixture({ surface }: { surface: string }) {
  const step = surface.replace("pub-activate-", "");
  const outcomeError: Record<string, string> = {
    expired: "expired_token",
    "rate-limited": "rate_limited",
    mfa: "mfa_required",
    network: "network_error",
  };
  const overrides: Partial<ActivationDeps["approval"]> =
    step === "loading"
      ? { getDeviceRequest: () => never() }
      : step in outcomeError
        ? {
            getDeviceRequest: async () =>
              ({
                ok: false,
                error: outcomeError[step],
                retryAfterSeconds: step === "rate-limited" ? 240 : undefined,
              }) as never,
          }
        : step === "deny-busy"
          ? { denyDeviceRequest: () => never() }
          : step === "decide-error"
            ? {
                approveDeviceRequest: async () =>
                  ({ ok: false, error: "network_error" }) as never,
              }
            : {};
  const [deps] = useState(() => activationDeps(surface, overrides));
  useAutoClick(
    step === "deny-busy"
      ? "Deny"
      : step === "decide-error" || step === "approved"
        ? "Approve"
        : null,
    600,
  );
  const initialCode =
    step === "enter" ? undefined : step === "enter-error" ? "KDR" : "KDRW-7QXN";
  return (
    <AuthSplitLayout>
      <DeviceActivation initialCode={initialCode} deps={deps} />
    </AuthSplitLayout>
  );
}

// ── sign-in with a device waiting ────────────────────────────────────────────

function SignInDeviceFixture() {
  return (
    <AuthSplitLayout
      caption="Connecting a device"
      subtitle={<DeviceWaitingNotice code="KDRW-7QXN" />}
    >
      <SignIn signUpUrl="/sign-up" appearance={AUTH_CARD_APPEARANCE} />
    </AuthSplitLayout>
  );
}

// ── DesktopLogin (Tauri) ─────────────────────────────────────────────────────

function DesktopFixture({ surface }: { surface: string }) {
  const step = surface.replace("pub-desktop-", "");
  // Read the clock once, on mount (render must stay pure).
  const [now] = useState(() => Date.now());
  const pending = (secondsLeft: number): DeviceSignInHookState => ({
    status: "pending",
    userCode: "KDRW-7QXN",
    verificationUri: "/activate",
    verificationUriComplete: "/activate?code=KDRW-7QXN",
    expiresAt: now + secondsLeft * 1000,
    interval: 5,
  });
  const states: Record<string, DeviceSignInHookState> = {
    idle: { status: "idle" },
    starting: { status: "starting" },
    pending: pending(600),
    expiring: pending(42),
    "open-failed": pending(600),
    verifying: { status: "approved", sessionToken: "tok_fixture_verifying" },
    rejected: { status: "approved", sessionToken: "tok_fixture_rejected" },
    unreachable: {
      status: "approved",
      sessionToken: "tok_fixture_unreachable",
    },
    denied: { status: "denied" },
    expired: { status: "expired" },
    error: { status: "error", error: "network_error", retryable: true },
    mfa: { status: "error", error: "mfa_required", retryable: false },
  };
  useState(() => {
    // The pending view opens the system browser; keep the fixture in place.
    window.open = (() => {
      if (step === "open-failed") throw new Error("blocked");
      return null;
    }) as never;
    return true;
  });
  useFetchStub((url) => {
    if (!url.includes("/api/users/me")) return null;
    if (step === "rejected") return json({ error: "nope" }, 401);
    if (step === "unreachable") return json({ error: "down" }, 503);
    return never();
  });
  const signIn = {
    state: states[step] ?? states.idle,
    start: () => {},
    cancel: () => {},
  } as never;
  return <DeviceSignInScreen isSignedIn={false} signIn={signIn} />;
}

// ── /invite/<code> ───────────────────────────────────────────────────────────

const INVITE: InvitePreview = {
  code: "quiet-pro",
  server: {
    id: "srv-design",
    name: "Design Review 🎨 and Late-Night Listening Club",
    icon_url: null,
    member_count: 1284,
  },
  inviter: {
    username: "grace",
    display_name: "Grace Hopper",
    avatar_url: null,
  },
};

function InviteFixture({ surface }: { surface: string }) {
  const step = surface.replace("pub-invite-", "");
  const signedOut = step === "signed-out" || step === "signin";
  // The token write notifies the root's auth state: not during render.
  const ready = useFixtureSetup(() => {
    if (signedOut) clearStoredKovaAuthSessionToken();
    else setStoredKovaAuthSessionToken("tok_fixture_invite");
  });
  useFetchStub((url) => {
    if (!url.includes("/api/invites/")) return null;
    if (url.endsWith("/join")) {
      if (step === "joining") return never();
      if (step === "member") {
        return json({ already_member: true, server: INVITE.server });
      }
      if (step === "error") return json({ error: "boom" }, 500);
      return json({ joined: true, server: INVITE.server });
    }
    if (step === "loading") return never();
    if (step === "invalid") return json({ error: "Invite not found" }, 404);
    if (step === "expired") return json({ error: "Invite has expired" }, 410);
    if (step === "signin") return json({ error: "Unauthorized" }, 401);
    return json(INVITE);
  });
  useAutoClick(
    step === "joining" ||
      step === "joined" ||
      step === "member" ||
      step === "error"
      ? "Accept invite"
      : null,
    800,
  );
  if (!ready) return null;
  return <InviteClient code="quiet-pro" redirectMs={10 * 60_000} />;
}

// ── /share/<token> ───────────────────────────────────────────────────────────

const SHARE: PublicShare = {
  token: "fixture",
  expires_at: "2026-11-23T18:30:00.000Z",
  allow_indexing: false,
  original_edited: false,
  snapshot: {
    content:
      "Shipping the Quiet Pro auth pages today. **Sign-in** is a flat 380px column now, and the art panel keeps the serif. Notes in #design-review.",
    author: {
      username: "ada",
      display_name: "Ada Lovelace, Countess of the Analytical Engine",
      avatar_url: null,
    },
    attachments: [],
    omitted_attachment_count: 2,
    embeds: [],
    reactions: [
      { emoji: "🎉", count: 12 },
      { emoji: "👀", count: 3 },
    ],
    reply_count: 4,
    created_at: "2026-10-23T15:04:00.000Z",
    source: { server_name: "Ralph HQ", channel_name: "design-review" },
  },
};

function ShareFixture({ surface }: { surface: string }) {
  const step = surface.replace("pub-share-", "");
  useFetchStub((url) => {
    if (!url.includes("/api/shared-messages/")) return null;
    if (step === "loading") return never();
    if (step === "error") return json({ error: "D1_ERROR: internal" }, 500);
    return null;
  });
  if (step === "loaded" || step === "edited") {
    return (
      <Scroll>
        <SharedMessagePage
          token="fixture"
          initialShare={{ ...SHARE, original_edited: step === "edited" }}
        />
      </Scroll>
    );
  }
  if (step === "gone") {
    return <SharedMessagePage token="fixture" initialGone />;
  }
  return <SharedMessagePage token="fixture" />;
}

// ── route boundaries ─────────────────────────────────────────────────────────

function Scroll({ children }: { children: ReactNode }) {
  return <div className="h-full overflow-y-auto">{children}</div>;
}

export function PublicFixture({ surface }: { surface: string }) {
  let content: ReactNode;
  if (surface.startsWith("pub-activate-")) {
    content = <ActivateFixture surface={surface} />;
  } else if (surface === "pub-sign-in-device") {
    content = <SignInDeviceFixture />;
  } else if (surface.startsWith("pub-desktop-")) {
    content = <DesktopFixture surface={surface} />;
  } else if (surface.startsWith("pub-invite-")) {
    content = <InviteFixture surface={surface} />;
  } else if (surface.startsWith("pub-share-")) {
    content = <ShareFixture surface={surface} />;
  } else if (surface === "pub-route-error") {
    content = (
      <RouteErrorPage
        error={new Error("D1_ERROR: no such table: message_shares")}
        reset={() => {}}
      />
    );
  } else if (surface === "pub-404") {
    content = <NotFoundPage />;
  } else {
    content = (
      <div className="grid h-full place-items-center text-ui-sm text-rm-text-muted">
        Unknown fixture: {surface}
      </div>
    );
  }
  return <Scroll>{content}</Scroll>;
}
