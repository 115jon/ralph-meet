import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { validateBody } from "@/lib/validate-body";
import { getSoundboardUploadUrl } from "@/lib/voice/soundboard-media";

export const myInstantsFavoriteBodySchema = z
  .object({
    action: z.string().optional(),
    sound: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
        color: z.string().optional(),
        soundType: z.string().optional(),
        emoji: z.string().optional(),
        serverId: z.string().optional(),
        source_server_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const GET = async ({ request }: { request: Request }) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();

  try {
    const { results } = await db
      .prepare(
        `SELECT f.sound_id as id, f.title, f.url, f.color,
                CASE WHEN a.soundboard_server_id IS NOT NULL THEN 'server'
                     ELSE f.sound_type END AS soundType,
                 f.emoji,
                 COALESCE(f.source_server_id, a.soundboard_server_id) AS source_server_id,
                 COALESCE(f.source_server_id, a.soundboard_server_id) AS serverId,
                 a.soundboard_server_id AS authoritative_server_id
           FROM myinstants_favorites f
           LEFT JOIN attachments a
             ON a.id = f.sound_id AND a.soundboard_server_id IS NOT NULL
          WHERE f.user_id = ?
          ORDER BY f.created_at DESC`,
      )
      .bind(userId)
      .all();

    const favorites = (results ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      const hasAuthoritativeServer =
        typeof record.authoritative_server_id === "string" &&
        record.authoritative_server_id.length > 0;
      const favorite = { ...record };
      delete favorite.authoritative_server_id;

      return hasAuthoritativeServer
        ? {
            ...favorite,
            url: getSoundboardUploadUrl(String(record.id)),
            soundType: "server",
          }
        : favorite;
    });

    return apiSuccess({ favorites });
  } catch {
    return apiError("Failed to fetch favorites", 500);
  }
};

const POST = async ({ request }: { request: Request }) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();

  try {
    const bodyResult = await validateBody(
      request,
      myInstantsFavoriteBodySchema,
      request,
    );
    if (bodyResult instanceof Response) return bodyResult;
    const { action, sound } = bodyResult;

    if (!action || !sound || !sound.id) {
      return apiError("Invalid payload", 400);
    }

    if (action === "add") {
      const sourceServerId = sound.source_server_id ?? sound.serverId ?? null;
      await db
        .prepare(
          `INSERT INTO myinstants_favorites (
             user_id, sound_id, title, url, color, sound_type, emoji, source_server_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, sound_id) DO UPDATE SET
             created_at = datetime('now'),
             sound_type = excluded.sound_type,
             emoji = excluded.emoji,
             title = excluded.title,
             url = excluded.url,
             color = excluded.color,
             source_server_id = excluded.source_server_id`,
        )
        .bind(
          userId,
          sound.id,
          sound.title,
          sound.url,
          sound.color || "",
          sound.soundType || "myinstants",
          sound.emoji || null,
          sourceServerId,
        )
        .run();
    } else if (action === "remove") {
      await db
        .prepare(
          `DELETE FROM myinstants_favorites WHERE user_id = ? AND sound_id = ?`,
        )
        .bind(userId, sound.id)
        .run();
    } else {
      return apiError("Invalid action", 400);
    }

    return apiSuccess({ success: true });
  } catch {
    return apiError("Failed to update favorite", 500);
  }
};

export const Route = createFileRoute("/api/myinstants/favorites")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});

export { GET, POST };
