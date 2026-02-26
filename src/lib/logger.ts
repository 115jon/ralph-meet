// ── Structured Logger ───────────────────────────────────────────────────────
// Lightweight structured logging for Cloudflare Workers.
// Outputs JSON lines to stdout, compatible with Workers Logpush / Tail Workers.
//
// Usage:
//   import { logger } from "@/lib/logger";
//   logger.info("User joined server", { userId, serverId });
//   logger.error("DB query failed", { error: err.message, query });

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Environment-based minimum level: default "info" in production, "debug" in dev
const MIN_LEVEL: LogLevel =
  (typeof process !== "undefined" && process.env?.NODE_ENV === "development")
    ? "debug"
    : "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function formatEntry(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>) {
    if (shouldLog("debug")) console.debug(formatEntry("debug", message, data));
  },

  info(message: string, data?: Record<string, unknown>) {
    if (shouldLog("info")) console.info(formatEntry("info", message, data));
  },

  warn(message: string, data?: Record<string, unknown>) {
    if (shouldLog("warn")) console.warn(formatEntry("warn", message, data));
  },

  error(message: string, data?: Record<string, unknown>) {
    if (shouldLog("error")) console.error(formatEntry("error", message, data));
  },

  /** Log an API request for observability */
  request(method: string, path: string, statusCode: number, durationMs: number, data?: Record<string, unknown>) {
    this.info("API request", {
      method,
      path,
      status_code: statusCode,
      duration_ms: durationMs,
      ...data,
    });
  },

  /** Log a security event (auth failure, rate limit, etc.) */
  security(event: string, data?: Record<string, unknown>) {
    this.warn("Security event", { event, ...data });
  },
};
