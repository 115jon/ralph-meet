const roomSlugPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const RESERVED_PUBLIC_DEMO_PREFIXES = ["voice-", "dm-call-"];

export function isPublicDemoRoomSlug(value: unknown): value is string {
  if (typeof value !== "string" || !roomSlugPattern.test(value)) return false;
  if (value === "global-gateway") return false;
  return !RESERVED_PUBLIC_DEMO_PREFIXES.some((prefix) =>
    value.startsWith(prefix),
  );
}
