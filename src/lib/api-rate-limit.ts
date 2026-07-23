import { SOUNDBOARD_UPLOAD_PATH } from "@/lib/voice/soundboard-media";

export function isStaticAssetRead(method: string, pathname: string): boolean {
  return (
    method === "GET" &&
    (pathname.startsWith("/api/attachments/") ||
      pathname.startsWith("/api/camera-backgrounds/"))
  );
}

export function isSoundboardMediaRead(
  method: string,
  pathname: string,
): boolean {
  const soundId = pathname.slice(SOUNDBOARD_UPLOAD_PATH.length);
  return (
    method === "GET" &&
    pathname.startsWith(SOUNDBOARD_UPLOAD_PATH) &&
    !!soundId &&
    !soundId.includes("/")
  );
}

export function getSoundboardMediaRateLimitKey(
  request: Request,
  requesterKey: string,
): string {
  const url = new URL(request.url);
  const capability = url.searchParams.get("cap");
  return `soundboard-media:requester:${requesterKey}:cap:${capability || "none"}:sound:${getSoundboardMediaSoundId(request)}`;
}

export function getSoundboardMediaAggregateRateLimitKey(
  _request: Request,
  requesterKey: string,
): string {
  return `soundboard-media:aggregate:requester:${requesterKey}`;
}

export function getSoundboardMediaRequesterRateLimitKey(
  request: Request,
  requesterKey: string,
): string {
  return `soundboard-media:requester:${requesterKey}:sound:${getSoundboardMediaSoundId(request)}`;
}

function getSoundboardMediaSoundId(request: Request): string {
  const encodedSoundId = new URL(request.url).pathname.slice(
    SOUNDBOARD_UPLOAD_PATH.length,
  );
  try {
    return decodeURIComponent(encodedSoundId);
  } catch {
    // Keep the bounded encoded value as the bucket component.
    return encodedSoundId;
  }
}
