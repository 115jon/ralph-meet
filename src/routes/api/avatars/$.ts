import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  apiSuccess,
  getBucket,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { logger } from "@/lib/logger";
import {
  deleteUserAvatarUpload,
  findUserAvatarUpload,
  listUserAvatarUploads,
  markUserAvatarUploadPendingDeletion,
} from "@/services/user-avatar.service";

// GET /api/avatars/{filename}
// Serves user avatars from R2 — publicly accessible (no auth)
// so they can be displayed in <img> tags without token issues.
const GET = async ({ request, params }: any) => {
  const { _splat } = params as { _splat?: string };
  const splatPath = _splat || "";

  if (splatPath === "history") {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;
    const items = await listUserAvatarUploads(getDB(), authResult.userId);
    return apiSuccess({
      items: items.map(({ id, avatar_url, content_type, created_at }) => ({
        id,
        avatar_url,
        content_type,
        created_at,
      })),
    });
  }

  const key = `avatars/${splatPath}`;

  const bucket = getBucket();
  const object = await bucket.get(key);

  if (!object) {
    return apiError("Avatar not found", 404);
  }

  const contentType = object.httpMetadata?.contentType || "image/png";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  // Short cache since key is reused on update — rely on R2 ETag for revalidation
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("ETag", object.etag);
  // Security headers
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'",
  );
  headers.set("Content-Disposition", "inline");

  return new Response(object.body as ReadableStream, {
    status: 200,
    headers,
  });
};

const DELETE = async ({ request, params }: any) => {
  const { _splat } = params as { _splat?: string };
  if (_splat !== "history") return apiError("Avatar not found", 404);

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return apiError("Invalid request body", 400);
  }
  if (typeof body.id !== "string" || !body.id.trim()) {
    return apiError("Invalid avatar upload id", 400);
  }

  const db = getDB();
  const upload = await findUserAvatarUpload(
    db,
    authResult.userId,
    body.id.trim(),
    true,
  );
  if (!upload) return apiError("Avatar upload not found", 404);

  if (
    upload.pending_delete !== 1 &&
    !(await markUserAvatarUploadPendingDeletion(
      db,
      authResult.userId,
      upload.id,
    ))
  ) {
    return apiError(
      "Change your active avatar before deleting this upload",
      409,
    );
  }

  try {
    await getBucket().delete(upload.file_key);
  } catch (error) {
    logger.error("user_avatar_upload_delete_cleanup_failed", {
      userId: authResult.userId,
      fileKey: upload.file_key,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError("Avatar deletion will be retried later", 503);
  }

  await deleteUserAvatarUpload(db, authResult.userId, upload.id);

  return apiSuccess({ ok: true, id: upload.id });
};

export const Route = createFileRoute("/api/avatars/$")({
  server: {
    handlers: {
      GET,
      DELETE,
    },
  },
});
