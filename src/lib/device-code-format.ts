import { buildAuthRouteUrl } from "@/lib/auth-route-urls";

/**
 * Device user-code helpers, matching Kova's hosted /device page exactly:
 * Crockford-ish alphabet (no 0/O/1/I), 8 characters shown as XXXX-XXXX.
 */

export const DEVICE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_CODE =
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

/** Any case, with or without the dash, alphabet only, capped at 8 → "ABCD-EFGH" (or a shorter prefix). */
export function formatDeviceCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let out = "";
  const upper = raw.toUpperCase();
  for (let i = 0; i < upper.length && out.length < 8; i++) {
    const ch = upper[i]!;
    if (DEVICE_CODE_ALPHABET.includes(ch)) out += ch;
  }
  return out.length > 4 ? `${out.slice(0, 4)}-${out.slice(4)}` : out;
}

export function isCompleteDeviceCode(value: string): value is string {
  return DEVICE_CODE.test(value);
}

/** "ABCD-EFGH" → "A B C D, E F G H" for screen readers. */
export function spelledDeviceCode(code: string): string {
  return code
    .split("-")
    .map((half) => Array.from(half).join(" "))
    .join(", ");
}

/** Same-origin, path-only return target for sign-in: "/activate?code=XXXX-XXXX". */
export function activateReturnPath(code: string): string {
  const formatted = formatDeviceCode(code);
  return isCompleteDeviceCode(formatted)
    ? `/activate?code=${formatted}`
    : "/activate";
}

/**
 * Where "Not you?" sends the browser after signing out:
 * "/sign-in?redirect_url=%2Factivate%3Fcode%3DXXXX-XXXX". It is passed to the
 * SDK's signOut as the callback so its afterSignOutUrl ("/sign-in", no query)
 * can't replace it. Built from the formatted code, so always a same-origin path.
 */
export function switchAccountSignInUrl(code: string): string {
  return buildAuthRouteUrl("/sign-in", {
    redirect_url: activateReturnPath(code),
  });
}

/** Where a failed release lands: /activate, signed out, showing "Code in use". */
export function releaseFailedPath(code: string): string {
  const formatted = formatDeviceCode(code);
  const params = new URLSearchParams();
  if (isCompleteDeviceCode(formatted)) params.set("code", formatted);
  params.set("release", "failed");
  return `/activate?${params.toString()}`;
}

/** "a minute" / "3 minutes", rounded up; undefined when unknown. */
export function waitPhrase(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "a minute" : `${minutes} minutes`;
}

const PLATFORM_NAMES: Record<string, string> = {
  windows: "Windows",
  win32: "Windows",
  win64: "Windows",
  win: "Windows",
  darwin: "macOS",
  macos: "macOS",
  mac: "macOS",
  osx: "macOS",
  "mac os": "macOS",
  "mac os x": "macOS",
  linux: "Linux",
  ios: "iOS",
  ipados: "iPadOS",
  android: "Android",
  chromeos: "ChromeOS",
  cros: "ChromeOS",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
};

export function prettyPlatform(
  platform: string | null | undefined,
): string | undefined {
  const value = platform?.trim();
  if (!value) return undefined;
  return PLATFORM_NAMES[value.toLowerCase()] ?? value;
}

/** Initials for the account chip: first letter of first and last word. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? [words[0]!, words[words.length - 1]!].map((w) => Array.from(w)[0] ?? "")
      : [Array.from(words[0] ?? email.trim())[0] ?? "?"];
  return letters.join("").toUpperCase();
}
