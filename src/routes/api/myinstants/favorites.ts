import { createFileRoute } from '@tanstack/react-router';
import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";

const GET = async ({ request }: { request: Request }) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  
  const db = getDB();

  try {
    const { results } = await db.prepare(
      `SELECT sound_id as id, title, url, color, sound_type as soundType, emoji FROM myinstants_favorites WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(userId).all();

    return apiSuccess({ favorites: results || [] });
  } catch (error) {
    return apiError("Failed to fetch favorites", 500);
  }
}

const POST = async ({ request }: { request: Request }) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  
  const db = getDB();

  try {
    const body = await request.json() as any;
    const { action, sound } = body;

    if (!action || !sound || !sound.id) {
      return apiError("Invalid payload", 400);
    }

    if (action === "add") {
      await db.prepare(
        `INSERT INTO myinstants_favorites (user_id, sound_id, title, url, color, sound_type, emoji)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, sound_id) DO UPDATE SET created_at = datetime('now'), sound_type = excluded.sound_type, emoji = excluded.emoji, title = excluded.title, url = excluded.url, color = excluded.color`
      ).bind(userId, sound.id, sound.title, sound.url, sound.color || "", sound.soundType || "myinstants", sound.emoji || null).run();
    } else if (action === "remove") {
      await db.prepare(
        `DELETE FROM myinstants_favorites WHERE user_id = ? AND sound_id = ?`
      ).bind(userId, sound.id).run();
    } else {
      return apiError("Invalid action", 400);
    }

    return apiSuccess({ success: true });
  } catch (error) {
    return apiError("Failed to update favorite", 500);
  }
}

export const Route = createFileRoute('/api/myinstants/favorites')({
  server: {
    handlers: {
      GET,
      POST,
    }
  }
});
