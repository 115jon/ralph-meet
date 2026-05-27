export const KOVA_AUTH_URL =
  import.meta.env.VITE_KOVA_AUTH_URL ?? "https://auth.115jon.site";

const DEV_KOVA_MEET_PUBLISHABLE_KEY =
  "pk_dev_fhygLR-eApZ4HvSfu-v-LEGFp7WAsgkLRhlveveNzhk";

export const KOVA_AUTH_PUBLISHABLE_KEY =
  import.meta.env.VITE_KOVA_AUTH_PUBLISHABLE_KEY ??
  DEV_KOVA_MEET_PUBLISHABLE_KEY;

export function getKovaAuthConfig() {
  return KOVA_AUTH_PUBLISHABLE_KEY
    ? { authUrl: KOVA_AUTH_URL, publishableKey: KOVA_AUTH_PUBLISHABLE_KEY }
    : { authUrl: KOVA_AUTH_URL };
}

export function getKovaAuthUrl() {
  return KOVA_AUTH_URL.replace(/\/$/, "");
}
