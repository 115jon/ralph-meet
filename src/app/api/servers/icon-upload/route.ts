import { genId, getBucket, requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

const MAX_ICON_SIZE = 8 * 1024 * 1024; // 8MB

// POST /api/servers/icon-upload — upload a server icon to R2
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  // Rate limit: reuse file upload limits
  const rl = checkRateLimit(userId, "icon-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Size limit
  if (file.size > MAX_ICON_SIZE) {
    return NextResponse.json(
      { error: "Icon too large (max 8MB)" },
      { status: 413 }
    );
  }

  // Image type validation
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: `Only image files are allowed (png, jpg, gif, webp, avif)` },
      { status: 415 }
    );
  }

  const iconId = genId();
  const ext = file.name.split(".").pop() ?? "png";
  const key = `server-icons/${iconId}.${ext}`;

  const bucket = getBucket();
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType },
  });

  // Return a path that the attachments route can serve
  // We use the same /api/attachments/... pattern by prefixing with "attachments/"
  // Actually, let's serve server icons from a dedicated path to avoid auth requirements
  return NextResponse.json(
    {
      url: `/api/server-icons/${iconId}.${ext}`,
      key,
    },
    { status: 201 }
  );
}
