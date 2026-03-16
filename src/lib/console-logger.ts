// ── Console Logger ──────────────────────────────────────────────────────────
// Lightweight browser console wrapper with timestamps, colors, and scoped tags.
// Zero external deps. Designed for dev-tools debugging of WebRTC/SFU flow.
//
// Usage:
//   import { clog } from "@/lib/console-logger";
//   const log = clog("MainGW");
//   log.info("WebSocket connected");          // [+0.123s] [MainGW] WebSocket connected
//   log.warn("Reconnecting...", { attempt });  // colored by tag

const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

function elapsed(): string {
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  return `+${(ms / 1000).toFixed(3)}s`;
}

// ── Tag color assignments ───────────────────────────────────────────────────
// HSL-based palette for high contrast in both light and dark dev-tools themes.
const TAG_COLORS: Record<string, string> = {
  MainGW: "color: #3b82f6; font-weight: bold", // blue
  VoiceGW: "color: #8b5cf6; font-weight: bold", // purple
  "VoiceGW:push": "color: #a855f7; font-weight: bold",
  "VoiceGW:pull": "color: #6d28d9; font-weight: bold",
  "SFU:Audio": "color: #22c55e; font-weight: bold", // green
  "SFU:Stereo": "color: #14b8a6; font-weight: bold", // teal
  VAD: "color: #f59e0b; font-weight: bold", // amber
  MediaDevices: "color: #06b6d4; font-weight: bold", // cyan
};

const TIMESTAMP_STYLE = "color: #6b7280; font-weight: normal"; // gray
const RESET_STYLE = "color: inherit; font-weight: normal";

let colorIndex = 0;
const FALLBACK_HUES = [330, 200, 30, 160, 280, 60, 350, 120]; // spread across hue wheel

function getTagStyle(tag: string): string {
  // Check exact match first, then prefix match (e.g. "VoiceGW:push:cam" → "VoiceGW:push")
  if (TAG_COLORS[tag]) return TAG_COLORS[tag];
  for (const prefix of Object.keys(TAG_COLORS)) {
    if (tag.startsWith(prefix)) return TAG_COLORS[prefix];
  }
  // Generate a stable color for unknown tags
  const hue = FALLBACK_HUES[colorIndex % FALLBACK_HUES.length];
  colorIndex++;
  const style = `color: hsl(${hue}, 70%, 50%); font-weight: bold`;
  TAG_COLORS[tag] = style;
  return style;
}

export interface ScopedLogger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

/**
 * Create a scoped logger for a subsystem tag.
 *
 * ```ts
 * const log = clog("VoiceGW");
 * log.info("Hello received", { interval: 15000 });
 * ```
 */
export function clog(tag: string): ScopedLogger {
  const tagStyle = getTagStyle(tag);

  function emit(
    fn: (...a: unknown[]) => void,
    msg: string,
    args: unknown[],
  ) {
    // Format: [+0.123s] [Tag] message  ...extraArgs
    fn(
      `%c[${elapsed()}]%c [${tag}]%c ${msg}`,
      TIMESTAMP_STYLE,
      tagStyle,
      RESET_STYLE,
      ...args,
    );
  }

  return {
    debug: (msg, ...args) => emit(console.debug, msg, args),
    info: (msg, ...args) => emit(console.log, msg, args),
    warn: (msg, ...args) => emit(console.warn, msg, args),
    error: (msg, ...args) => emit(console.error, msg, args),
  };
}
