import { getWebOrigin } from "@/lib/platform";

export interface MediaActionTarget {
  url: string;
  downloadUrl?: string;
  filename?: string;
}

export function getPublicMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${getWebOrigin()}${path}`;
}

export function getMediaFilename(url: string, fallback = "media"): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop()?.trim();
    if (filename) return decodeURIComponent(filename);
  } catch {
    // Use the fallback when the media URL is not parseable.
  }

  return fallback;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(
      value,
      typeof window !== "undefined"
        ? window.location.href
        : "https://localhost",
    );
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function saveMedia(target: MediaActionTarget): Promise<void> {
  const downloadUrl = target.downloadUrl || target.url;
  const filename = target.filename || getMediaFilename(target.url);
  if (!isHttpUrl(downloadUrl)) return;

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok)
      throw new Error(`Media request failed: ${response.status}`);

    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    return;
  } catch {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = filename;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}

export async function copyMediaLink(url: string): Promise<void> {
  await navigator.clipboard.writeText(url);
}
