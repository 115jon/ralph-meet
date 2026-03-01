import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";


// GET /api/read-states — fetch all read states for the authenticated user
export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();

  // Get read states for all channels the user is subscribed to
  const { results } = await db.prepare(
    `SELECT rs.channel_id, rs.last_read_at
     FROM read_states rs
     INNER JOIN channels c ON c.id = rs.channel_id
     INNER JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ?
     WHERE rs.user_id = ?`
  ).bind(userId, userId).all();

  // Also get the latest message timestamp per channel (for comparison)
  const { results: latestMessages } = await db.prepare(
    `SELECT m.channel_id, MAX(m.created_at) as last_message_at
     FROM messages m
     INNER JOIN channels c ON c.id = m.channel_id
     INNER JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ?
     GROUP BY m.channel_id`
  ).bind(userId).all();

  return apiSuccess({
    read_states: results ?? [],
    last_messages: latestMessages ?? [],
  });
}
