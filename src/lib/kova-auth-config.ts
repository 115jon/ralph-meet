import {
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY,
  DEFAULT_KOVA_AUTH_URL,
} from "@/lib/site-defaults";

export const KOVA_AUTH_URL =
  import.meta.env.VITE_KOVA_AUTH_URL ?? DEFAULT_KOVA_AUTH_URL;

export const KOVA_AUTH_PUBLISHABLE_KEY =
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
