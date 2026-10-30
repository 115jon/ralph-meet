import {
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY,
  DEFAULT_KOVA_AUTH_URL,
} from "@/lib/site-defaults";

export const KOVA_AUTH_URL =
  import.meta.env.VITE_KOVA_AUTH_URL ?? DEFAULT_KOVA_AUTH_URL;

/**
 * `RALPH_DEV_KOVA_KEY` exists only under `vite dev` (vite.config.ts picks it
 * from RALPH_AUTH, see lib/dev-auth-target) and is the same constant the
 * worker reads, so the two can never sign in against different apps.
 * Builds never define it.
 */
export const KOVA_AUTH_PUBLISHABLE_KEY: string =
  import.meta.env.RALPH_DEV_KOVA_KEY ??
  import.meta.env.VITE_KOVA_AUTH_PUBLISHABLE_KEY ??
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY;

export function getKovaAuthConfig() {
  return KOVA_AUTH_PUBLISHABLE_KEY
    ? { authUrl: KOVA_AUTH_URL, publishableKey: KOVA_AUTH_PUBLISHABLE_KEY }
    : { authUrl: KOVA_AUTH_URL };
}

export function getKovaAuthUrl() {
  return KOVA_AUTH_URL.replace(/\/$/, "");
}
