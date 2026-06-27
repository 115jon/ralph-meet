export const MEDIA_CONTENT_FILTER_LEVELS = ["high", "medium", "low", "off"] as const;

export type MediaContentFilter = (typeof MEDIA_CONTENT_FILTER_LEVELS)[number];

export const DEFAULT_MEDIA_CONTENT_FILTER: MediaContentFilter = "high";

export type MediaContentFilterOption = {
  value: MediaContentFilter;
  label: string;
  badge: string;
  description: string;
};

export const MEDIA_CONTENT_FILTER_OPTIONS: readonly MediaContentFilterOption[] = [
  {
    value: "high",
    label: "High",
    badge: "G only",
    description: "Shows the strictest results for general audiences.",
  },
  {
    value: "medium",
    label: "Medium",
    badge: "G + PG",
    description: "Allows a little more expressiveness while staying broadly safe.",
  },
  {
    value: "low",
    label: "Low",
    badge: "Up to PG-13",
    description: "Includes more mature jokes and reactions without going fully open.",
  },
  {
    value: "off",
    label: "Off",
    badge: "Up to R",
    description: "Shows the widest provider-approved range. Explicit nudity is still excluded.",
  },
] as const;

export function isMediaContentFilter(value: unknown): value is MediaContentFilter {
  return typeof value === "string" && (MEDIA_CONTENT_FILTER_LEVELS as readonly string[]).includes(value);
}

export function parseMediaContentFilter(
  value: unknown,
  fallback: MediaContentFilter = DEFAULT_MEDIA_CONTENT_FILTER
): MediaContentFilter {
  return isMediaContentFilter(value) ? value : fallback;
}
