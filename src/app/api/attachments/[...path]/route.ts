import { apiSuccess, apiError, getBucket, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// GET /api/attachments/{channelId}/{attachmentId}/{filename}
// R2 key = attachments/{channelId}/{attachmentId}/{filename}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Require authentication — files should not be publicly accessible
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { path } = await params;
  const key = `attachments/${path.join("/")}`;

  const bucket = getBucket();
  const object = await bucket.get(key);

  if (!object) {
    return apiError("File not found", 404);
  }

  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const filename = path[path.length - 1] || "download";
  const isInline = contentType.startsWith("image/") || contentType.startsWith("video/") || contentType === "application/pdf";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Content-Disposition", `${isInline ? "inline" : "attachment"}; filename="${filename}"`);

  return new NextResponse(object.body as ReadableStream, {
    status: 200,
    headers,
  });
}

