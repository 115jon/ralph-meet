export type PresencePlatform = "desktop" | "mobile" | "web";

const PRESENCE_PLATFORMS: readonly PresencePlatform[] = [
  "desktop",
  "mobile",
  "web",
];

export function normalizePresencePlatform(
  value: unknown,
): PresencePlatform | null {
  if (typeof value !== "string") return null;
  return PRESENCE_PLATFORMS.includes(value as PresencePlatform)
    ? (value as PresencePlatform)
    : null;
}

export function normalizePresencePlatforms(value: unknown): PresencePlatform[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<PresencePlatform>();
  for (const item of value) {
    const normalized = normalizePresencePlatform(item);
    if (normalized) {
      seen.add(normalized);
    }
  }

  return PRESENCE_PLATFORMS.filter((platform) => seen.has(platform));
}
