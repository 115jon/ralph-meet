import { apiError, apiSuccess, broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// GET /api/presence — fetch current user's mapped D1 profile
export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const user = await db.prepare("SELECT status, custom_status FROM users WHERE id = ?").bind(userId).first();

  return apiSuccess({
    status: user?.status ?? "online",
    custom_status: user?.custom_status ?? null,
  });
}

// POST /api/presence — update user's presence status
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as {
    status: "online" | "idle" | "dnd" | "offline";
    custom_status?: string;
  };

  if (!["online", "idle", "dnd", "offline"].includes(body.status)) {
    return apiError("Invalid status", 400);
  }

  const db = getDB();

  try {
    // We assume the user exists in the DB since it syncs on signup/login.
    // If not, we could do an upsert or let it fail gracefully.
    await db.prepare(
      `UPDATE users SET status = ?, custom_status = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(body.status, body.custom_status || null, userId)
      .run();
  } catch (error) {
    console.error("[api/presence] Failed to update user presence in DB:", error);
    // Even if DB update fails, we might still want to broadcast, but logging is vital.
  }

  // Broadcast PRESENCE_UPDATE to all connected clients
  await broadcastToAll("PRESENCE_UPDATE", {
    user_id: userId,
    status: body.status,
    custom_status: body.custom_status,
  });

  return apiSuccess({ status: body.status, custom_status: body.custom_status });
}
