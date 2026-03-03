import { createFileRoute } from '@tanstack/react-router';

/**
 * GET /api/auth/desktop — Desktop app OAuth redirect
 *
 * This route is hit by the system browser after the user signs in via Clerk.
 * It extracts the Clerk session token and redirects to ralphmeet://auth?token=<jwt>,
 * which the desktop app captures via its registered URI scheme handler.
 *
 * Flow:
 * 1. Desktop app opens browser to /api/auth/desktop
 * 2. If not signed in → Clerk sign-in page → redirect back here
 * 3. Extract session JWT → redirect to ralphmeet://auth?token=<jwt>
 */
const GET = async ({ request }: { request: Request }) => {
  const { auth, clerkClient } = await import("@clerk/tanstack-react-start/server");
  const authState = await auth();

  if (!authState.userId) {
    // Not signed in — redirect to Clerk sign-in, then back here after
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('redirect_url', '/api/auth/desktop');
    return new Response(null, {
      status: 302,
      headers: { Location: signInUrl.toString() },
    });
  }

  // Generate a long-lived custom JWT (e.g. 30 days) for the desktop client
  // By default authState.getToken() is only valid for 1 minute
  let token: string | null = null;
  try {
    const client = await clerkClient();
    const result = await client.sessions.getToken(authState.sessionId!, "desktop-client");
    token = result.jwt;
  } catch (e) {
    console.error("Failed to generate custom desktop token:", e);
    // Fallback to the short lived token if custom template fails or isn't set up
    token = await authState.getToken();
  }

  if (!token) {
    return new Response('Failed to get session token', { status: 500 });
  }

  // Redirect to the desktop app's custom URI scheme
  const desktopUri = `ralphmeet://auth?token=${encodeURIComponent(token)}`;

  // Show a brief HTML page that auto-redirects (some browsers block direct
  // protocol handler redirects via 302)
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Redirecting to Ralph Meet...</title></head>
<body style="background:#070709;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center">
    <h2>Redirecting to Ralph Meet Desktop...</h2>
    <p style="color:#888">If the app doesn't open, <a href="${desktopUri}" style="color:#5865f2">click here</a>.</p>
  </div>
  <script>window.location.href = ${JSON.stringify(desktopUri)};</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};

export const Route = createFileRoute('/api/auth/desktop')({
  server: {
    handlers: {
      GET,
    },
  },
});
