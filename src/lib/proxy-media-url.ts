import { apiUrl } from "@/lib/platform";

export function buildProxyMediaPath(rawUrl: string, sourceUrl?: string | null): string {
  const params = new URLSearchParams({ url: rawUrl });
  if (sourceUrl) {
    params.set("sourceUrl", sourceUrl);
  }

  return `/api/proxy-media?${params.toString()}`;
}

export function buildProxyMediaUrl(rawUrl: string, sourceUrl?: string | null): string {
  return apiUrl(buildProxyMediaPath(rawUrl, sourceUrl));
}
