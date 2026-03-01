import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, genId, getBucket, requireAuth } from "@/lib/api-helpers";
import { MAX_IMAGE_SIZE, validateImageBuffer } from "@/lib/image-validation";
import { logger } from "@/lib/logger";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";


// POST /api/servers/icon-upload — upload a server icon to R2
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Rate limit: reuse file upload limits (global DO limit)
  const rl = await checkRateLimitDO(userId, "icon-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return apiError("No file provided", 400);
  }

  // Size limit
  if (file.size > MAX_IMAGE_SIZE) {
    return apiError("Icon too large (max 8MB)", 413);
  }

  // ── Magic byte validation ───────────────────────────────────────
  const buffer = await file.arrayBuffer();
  const validation = validateImageBuffer(buffer);

  if (!validation.ok) {
    logger.security("icon_upload_invalid_magic_bytes", {
      userId,
      filename: file.name,
      declared_type: file.type,
    });
    return apiError(validation.error, 415);
  }

  const iconId = genId();
  const key = `server-icons/${iconId}.${validation.ext}`;

  const bucket = getBucket();
  await bucket.put(key, buffer, {
    httpMetadata: { contentType: validation.mimeType },
  });

  return apiSuccess(
    {
      url: `/api/server-icons/${iconId}.${validation.ext}`,
      key,
    },
    201
  );
}


export const Route = createFileRoute('/api/servers/icon-upload')({
  server: {
    handlers: {
      POST,
    }
  }
});
