export const RALPH_AUTH_URL =
  import.meta.env.VITE_RALPH_AUTH_URL ?? "https://auth.115jon.site";

const DEV_RALPH_MEET_PUBLISHABLE_KEY =
  "pk_dev_fhygLR-eApZ4HvSfu-v-LEGFp7WAsgkLRhlveveNzhk";

export const RALPH_AUTH_PUBLISHABLE_KEY =
  import.meta.env.VITE_RALPH_AUTH_PUBLISHABLE_KEY ??
  DEV_RALPH_MEET_PUBLISHABLE_KEY;

export function getRalphAuthConfig() {
  return RALPH_AUTH_PUBLISHABLE_KEY
    ? { authUrl: RALPH_AUTH_URL, publishableKey: RALPH_AUTH_PUBLISHABLE_KEY }
    : { authUrl: RALPH_AUTH_URL };
}

export function getRalphAuthUrl() {
  return RALPH_AUTH_URL.replace(/\/$/, "");
}
