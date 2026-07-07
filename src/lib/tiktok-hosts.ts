const TIKTOK_CDN_HOST_PATTERN = /(^|\.)tiktokcdn-[a-z0-9-]+\.com$/i;

export function isTikTokCdnHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "tiktokcdn.com"
    || normalized.endsWith(".tiktokcdn.com")
    || TIKTOK_CDN_HOST_PATTERN.test(normalized)
  );
}

export function isTikTokMediaHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === "api16-normal-useast5.tiktokv.us"
    || normalized.endsWith(".tiktokv.us")
    || isTikTokCdnHostname(normalized)
  );
}
