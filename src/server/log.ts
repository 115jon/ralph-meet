import { Logger } from "effect";

/** The span that times each request. Its length lands in the log line as `durationMs`. */
export const REQUEST_SPAN = "request";

/**
 * One flat object per log call, written through the console method for its
 * level. Workers Logs indexes the fields of a logged object, so annotations
 * sit at the top level. Annotate with names and counts only: never tokens,
 * cookies, headers or bodies.
 */
export const routeLogger = Logger.withLeveledConsole(
  Logger.map(Logger.formatStructured, (entry) => ({
    level: entry.level,
    message: entry.message,
    timestamp: entry.timestamp,
    ...entry.annotations,
    durationMs: entry.spans[REQUEST_SPAN],
    cause: entry.cause,
  })),
);

export const RouteLogger = Logger.layer([routeLogger]);
