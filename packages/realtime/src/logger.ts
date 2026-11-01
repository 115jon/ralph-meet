// ── Logger ──────────────────────────────────────────────────────────────────
// The socket and its heartbeat log through a scoped logger. The default
// writes plain `[tag] message` lines to the console, which works in a
// browser, React Native and Workers alike; an app can install its own (the
// web app installs its coloured console logger in src/lib/realtime-socket)
// before it creates a socket.

export interface ScopedLogger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export type RealtimeLoggerFactory = (tag: string) => ScopedLogger;

const consoleLogger: RealtimeLoggerFactory = (tag) => ({
  debug: (msg, ...args) => console.debug(`[${tag}] ${msg}`, ...args),
  info: (msg, ...args) => console.log(`[${tag}] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[${tag}] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[${tag}] ${msg}`, ...args),
});

let factory: RealtimeLoggerFactory = consoleLogger;

/** Replaces the logger for sockets created from now on. */
export function setRealtimeLogger(next: RealtimeLoggerFactory): void {
  factory = next;
}

/** A logger scoped to `tag`, from the installed factory. */
export function clog(tag: string): ScopedLogger {
  return factory(tag);
}
