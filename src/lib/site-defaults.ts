/**
 * Default deployment hostnames. These are fallbacks only; deployments override
 * them via VITE_PUBLIC_WEB_URL, VITE_API_BASE_URL, VITE_KOVA_AUTH_URL /
 * KOVA_AUTH_URL, VITE_KOVA_AUTH_PUBLISHABLE_KEY and VITE_ABUSE_EMAIL.
 * Keep this module dependency-free so Worker entry code can import it.
 */
export const DEFAULT_PUBLIC_WEB_URL = "https://yap.115jon.com";
/**
 * The web home before the Yap rename. The Worker still serves it so installed
 * desktop and mobile builds keep working; browser page loads there 301 to
 * DEFAULT_PUBLIC_WEB_URL (src/server/legacy-host.ts). Remove once old clients
 * are gone.
 */
export const LEGACY_PUBLIC_WEB_URL = "https://meet.115jon.site";
export const DEFAULT_KOVA_AUTH_URL = "https://auth.115jon.site";
export const DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY =
  "pk_live_yl2Z9ssEwlWuOYHVRWozk9WThozu4nFP3QAhCWAsPhE";
export const DEFAULT_ABUSE_EMAIL = "abuse@115jon.site";
