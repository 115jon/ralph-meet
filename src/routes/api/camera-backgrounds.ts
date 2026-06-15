import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, genId, getBucket, requireAuth } from "@/lib/api-helpers";
import { CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES } from "@/lib/camera-background-validation";
import { validateImageBuffer } from "@/lib/image-validation";
import { logger } from "@/lib/logger";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";

interface CameraBackgroundAsset {
  id: string;
  name: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  createdAt: number;
}

interface ListedR2Object {
  key: string;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
  uploaded?: Date;
  size: number;
}

const BACKGROUND_PREFIX = "camera-backgrounds";

function userPrefix(userId: string): string {
  return `${BACKGROUND_PREFIX}/${userId}/`;
}

function sanitizeBaseName(name: string): string {
  const filename = name.split(/[\\/]/).pop() ?? "background";
  const withoutExtension = filename.replace(/\.[^.]*$/, "").trim();
  const safe = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return safe || "background";
}

function backgroundUrl(id: string, filename: string): string {
  return `/api/camera-backgrounds/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;
}

function parseBackgroundObject(userId: string, object: ListedR2Object): CameraBackgroundAsset | null {
  const prefix = userPrefix(userId);
  if (!object.key.startsWith(prefix)) return null;

  const suffix = object.key.slice(prefix.length);
  const slashIndex = suffix.indexOf("/");
  if (slashIndex <= 0 || slashIndex === suffix.length - 1) return null;

  const id = suffix.slice(0, slashIndex);
  const filename = suffix.slice(slashIndex + 1);
  const createdAt = Number(object.customMetadata?.createdAt) || object.uploaded?.getTime() || 0;

  return {
    id,
    name: object.customMetadata?.name || filename,
    url: backgroundUrl(id, filename),
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    sizeBytes: object.size,
    createdAt,
  };
}

async function listBackgrounds(userId: string): Promise<CameraBackgroundAsset[]> {
  const bucket = getBucket();
  const listed = await bucket.list({
    prefix: userPrefix(userId),
    include: ["httpMetadata", "customMetadata"],
  });

  return (listed.objects as ListedR2Object[])
    .map((object) => parseBackgroundObject(userId, object))
    .filter((background): background is CameraBackgroundAsset => Boolean(background))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const GET = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  return apiSuccess({ backgrounds: await listBackgrounds(authResult.userId) }, 200, request);
};

export const POST = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const rl = await checkRateLimitDO(userId, "camera-background-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return apiError("No file provided", 400, undefined, request);

  if (file.size > CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES) {
    return apiError("Background image too large (max 25MB)", 413, undefined, request);
  }

  const buffer = await file.arrayBuffer();
  const validation = validateImageBuffer(buffer);
  if (!validation.ok) {
    logger.security("camera_background_upload_invalid_magic_bytes", {
      userId,
      filename: file.name,
      declared_type: file.type,
    });
    return apiError(validation.error, 415, undefined, request);
  }

  const id = genId();
  const filename = `${sanitizeBaseName(file.name)}.${validation.ext}`;
  const key = `${userPrefix(userId)}${id}/${filename}`;
  const createdAt = Date.now();

  await getBucket().put(key, buffer, {
    httpMetadata: { contentType: validation.mimeType },
    customMetadata: {
      id,
      name: file.name || filename,
      createdAt: String(createdAt),
    },
  });

  logger.info("camera_background_uploaded", {
    userId,
    id,
    filename: file.name,
    contentType: validation.mimeType,
    sizeBytes: file.size,
  });

  return apiSuccess({
    id,
    name: file.name || filename,
    url: backgroundUrl(id, filename),
    contentType: validation.mimeType,
    sizeBytes: file.size,
    createdAt,
  } satisfies CameraBackgroundAsset, 201, request);
};

export const DELETE = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400, undefined, request);
  }

  const id = body.id?.trim();
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return apiError("Invalid background id", 400, undefined, request);
  }

  const bucket = getBucket();
  const listed = await bucket.list({ prefix: `${userPrefix(userId)}${id}/` });
  if (listed.objects.length > 0) {
    await bucket.delete((listed.objects as ListedR2Object[]).map((object) => object.key));
  }

  return apiSuccess({ ok: true }, 200, request);
};

export const Route = createFileRoute("/api/camera-backgrounds")({
  server: {
    handlers: {
      GET,
      POST,
      DELETE,
    },
  },
});
