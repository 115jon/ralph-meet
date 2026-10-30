import { createFileRoute } from "@tanstack/react-router";

/**
 * Compatibility entrypoint for older native builds that started the
 * deep-link sign-in here. Desktop and mobile now sign in with a device code,
 * so this lands on the device-code page instead of handing a session to a
 * `ralphmeet://auth` link.
 */
export const GET = async ({ request }: { request: Request }) => {
  return new Response(null, {
    status: 302,
    headers: { Location: new URL("/activate", request.url).toString() },
  });
};

export const Route = createFileRoute("/api/auth/desktop")({
  server: {
    handlers: {
      GET,
    },
  },
});
