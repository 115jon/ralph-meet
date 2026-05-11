import { createFileRoute } from "@tanstack/react-router";

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";

const GET = async ({ request: req }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const username = url.searchParams.get("username")?.trim().toLowerCase();
  if (!username || username.length < 2) {
    return apiSuccess({ available: false, reason: "too_short" });
  }

  try {
    const existing = await getDB()
      .prepare(`SELECT id FROM users WHERE lower(username) = ? LIMIT 1`)
      .bind(username)
      .first<{ id: string }>();

    return apiSuccess({ available: !existing || existing.id === userId });
  } catch (err) {
    console.error("[check-username] Error:", err);
    return apiSuccess({ available: false, reason: "error" });
  }
};

export const Route = createFileRoute("/api/check-username")({
  server: {
    handlers: {
      GET,
    },
  },
});
