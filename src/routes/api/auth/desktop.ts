import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/auth/desktop — Desktop app browser-based sign-in
 *
 * Flow:
 * 1. Desktop app opens system browser to /api/auth/desktop
 * 2. If not signed in → redirects to Clerk sign-in (with redirect back here)
 * 3. If signed in → creates a one-time sign-in token via Clerk Backend API
 * 4. Redirects to ralphmeet://auth?ticket=<token>
 * 5. Desktop app uses the ticket to establish a full Clerk session in the webview
 *    via clerk.client.signIn.create({ strategy: "ticket", ticket })
 */
const GET = async ({ request: req }: any) => {
  const { auth, clerkClient } = await import("@clerk/tanstack-react-start/server");

  let authState;
  try {
    authState = await auth();
  } catch {
    authState = { userId: null, sessionId: null };
  }

  // Not signed in — redirect to Clerk sign-in page
  if (!authState.userId) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", "/api/auth/desktop");
    return new Response(null, {
      status: 302,
      headers: { Location: signInUrl.toString() },
    });
  }

  // Generate a one-time sign-in token (valid for 60 seconds)
  try {
    const client = await clerkClient();
    const signInToken = await client.signInTokens.createSignInToken({
      userId: authState.userId,
      expiresInSeconds: 60,
    });

    // Redirect to desktop app via deep link with the ticket
    return new Response(null, {
      status: 302,
      headers: { Location: `ralphmeet://auth?ticket=${signInToken.token}` },
    });
  } catch (e) {
    console.error("[desktop-auth] Failed to create sign-in token:", e);
    return new Response(
      JSON.stringify({ error: "Failed to create sign-in token" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const Route = createFileRoute("/api/auth/desktop")({
  server: {
    handlers: {
      GET,
    },
  },
});
