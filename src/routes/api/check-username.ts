import { createFileRoute } from "@tanstack/react-router";

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { clog } from "@/lib/console-logger";
import { UsernameSchema } from "@/lib/validations";

const log = clog("check-username");

const GET = async ({ request: req }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const rawUsername = url.searchParams.get("username")?.trim();
  if (!rawUsername) {
    return apiSuccess({ available: false, reason: "too_short" });
  }
  const parsedUsername = UsernameSchema.safeParse(rawUsername);
  if (!parsedUsername.success) {
    return apiSuccess({ available: false, reason: "invalid" });
  }
  const username = parsedUsername.data;

  try {
    const existing = await getDB()
      .prepare(`SELECT id FROM users WHERE lower(username) = ? LIMIT 1`)
      .bind(username)
      .first<{ id: string }>();

    return apiSuccess({ available: !existing || existing.id === userId });
  } catch (err) {
    log.error("Error:", err);
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
