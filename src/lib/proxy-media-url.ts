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

export function unwrapProxyMediaUrl(url: string): string {
  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : "https://localhost",
    );
    const proxied =
      parsed.pathname === "/api/proxy-media" || parsed.pathname.endsWith("/api/proxy-media")
        ? parsed.searchParams.get("url")
        : null;
    return proxied || url;
  } catch {
    return url;
  }
}
