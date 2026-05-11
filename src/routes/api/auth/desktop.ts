import { createFileRoute } from "@tanstack/react-router";

/**
 * Compatibility entrypoint for older native builds. New desktop/mobile clients
 * open /sign-in?redirect_url=ralphmeet://auth directly.
 */
const GET = async ({ request }: any) => {
  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("redirect_url", "ralphmeet://auth");
  return new Response(null, {
    status: 302,
    headers: { Location: signInUrl.toString() },
  });
};

export const Route = createFileRoute("/api/auth/desktop")({
  server: {
    handlers: {
      GET,
    },
  },
});
