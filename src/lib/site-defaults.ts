/**
 * Default deployment hostnames. These are fallbacks only; deployments override
 * them via VITE_PUBLIC_WEB_URL, VITE_API_BASE_URL, VITE_KOVA_AUTH_URL /
 * KOVA_AUTH_URL, VITE_KOVA_AUTH_PUBLISHABLE_KEY and VITE_ABUSE_EMAIL.
 * Keep this module dependency-free so Worker entry code can import it.
 */
export const DEFAULT_PUBLIC_WEB_URL = "https://meet.115jon.site";
export const DEFAULT_KOVA_AUTH_URL = "https://auth.115jon.site";
export const DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY =
  "pk_live_yl2Z9ssEwlWuOYHVRWozk9WThozu4nFP3QAhCWAsPhE";
export const DEFAULT_ABUSE_EMAIL = "abuse@115jon.site";
