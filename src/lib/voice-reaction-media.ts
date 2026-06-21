import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";

export function getVoiceReactionMediaUrl(url: string, contentType: string): string {
  return contentType === "video/mp4" ? getMediaUrl(url) : getAuthAssetUrl(url);
}
