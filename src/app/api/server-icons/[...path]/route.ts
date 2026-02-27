import { getBucket } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// GET /api/server-icons/{filename}
// Serves server icons from R2 — publicly accessible (no auth)
// so they can be displayed in <img> tags without token issues.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const key = `server-icons/${path.join("/")}`;

  const bucket = getBucket();
  const object = await bucket.get(key);

  if (!object) {
    return NextResponse.json({ error: "Icon not found" }, { status: 404 });
  }

  const contentType =
    object.httpMetadata?.contentType || "image/png";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new NextResponse(object.body as ReadableStream, {
    status: 200,
    headers,
  });
}
