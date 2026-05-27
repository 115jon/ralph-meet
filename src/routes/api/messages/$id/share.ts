import { apiError, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { ServiceError } from "@/lib/service-error";
import { createMessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

const EXPIRY_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  never: null,
};

function expiryFromBody(value: unknown, now: Date): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(value in EXPIRY_DAYS)) {
    throw ServiceError.badRequest("Invalid expiry");
  }
  const days = EXPIRY_DAYS[value];
  if (days === null) return null;
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days);
  return expiresAt.toISOString();
}

const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: messageId } = params;
  const db = getDB();

  const source = await db.prepare(
    `SELECT channel_id FROM messages WHERE id = ?`
  ).bind(messageId).first() as { channel_id: string } | null;

  if (!source) return apiError("Message not found", 404);

  const accessResult = await requireChannelAccess(userId, source.channel_id);
  if (accessResult instanceof Response) return accessResult;

  try {
    const body = await request.json().catch(() => ({}));
    const now = new Date();
    const share = await createMessageShare(db, {
      messageId,
      createdBy: userId,
      now,
      expiresAt: expiryFromBody((body as { expires?: unknown }).expires, now),
    });
    const url = new URL(request.url);
    const share_url = `${url.origin}/share/${share.token}`;

    return Response.json({ share, share_url }, { status: 201 });
  } catch (error) {
    if (error instanceof ServiceError) {
      return apiError(error.message, error.status, error.code);
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/messages/$id/share")({
  server: {
    handlers: {
      POST,
    },
  },
});
