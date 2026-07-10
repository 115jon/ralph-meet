import type { VoiceConnectionStats } from "@/lib/sfu-client";

type Clock = () => Date;

const SENSITIVE_KEY_PATTERN = /(token|authorization|secret|clerk|user[_-]?id)/i;

export interface VoiceDiagnosticsBundleInput {
  detailedStats: unknown;
  connectionStats: VoiceConnectionStats | null;
  channelName?: string;
  locationHref?: string;
  userAgent?: string;
  now?: Clock;
}

export function buildVoiceDiagnosticsBundle({
  detailedStats,
  connectionStats,
  channelName,
  locationHref,
  userAgent,
  now = () => new Date(),
}: VoiceDiagnosticsBundleInput) {
  return {
    app: "Ralph Meet",
    copiedAt: now().toISOString(),
    channelName: channelName ?? null,
    page: sanitizePageUrl(locationHref),
    userAgent: userAgent ?? null,
    connectionStats: redactDiagnosticsValue(connectionStats),
    detailedStats: redactDiagnosticsValue(detailedStats),
  };
}

function sanitizePageUrl(locationHref?: string) {
  if (!locationHref) return null;
  try {
    const url = new URL(locationHref);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function redactDiagnosticsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticsValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? "[redacted]"
          : redactDiagnosticsValue(entry),
      ]),
    );
  }

  return value;
}
