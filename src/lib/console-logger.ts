// ── Console Logger ──────────────────────────────────────────────────────────
// Lightweight browser console wrapper with timestamps, colors, and scoped tags.
// Zero external deps. Designed for dev-tools debugging of WebRTC/SFU flow.
//
// Usage:
//   import { clog } from "@/lib/console-logger";
//   const log = clog("ChatGW");
//   log.info("WebSocket connected");          // [+0.123s] [ChatGW] WebSocket connected
//   log.warn("Reconnecting...", { attempt });  // colored by tag

function elapsed(): string {
  // Use local time formatted similar to ISO but more readable
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// ── Tag color assignments ───────────────────────────────────────────────────
// HSL-based palette for high contrast in both light and dark dev-tools themes.
const TAG_COLORS: Record<string, string> = {
  // ── Gateway / Room tags ───────────────────────────────────────────────
  ChatGW: "color: #3b82f6; font-weight: bold", // blue
  VoiceGW: "color: #8b5cf6; font-weight: bold", // purple
  "VoiceGW:push": "color: #a855f7; font-weight: bold",
  "VoiceGW:pull": "color: #6d28d9; font-weight: bold",
  MeetingRoom: "color: #60a5fa; font-weight: bold", // light blue
  VoiceRoom: "color: #c084fc; font-weight: bold", // light purple
  "VoiceRoom:SFU": "color: #d946ef; font-weight: bold", // fuchsia
  // ── SFU / Audio tags ──────────────────────────────────────────────────
  "SFU:Audio": "color: #22c55e; font-weight: bold", // green
  "SFU:Stereo": "color: #14b8a6; font-weight: bold", // teal
  VAD: "color: #f59e0b; font-weight: bold", // amber
  MediaDevices: "color: #06b6d4; font-weight: bold", // cyan
  // ── Desktop / Auth tags ───────────────────────────────────────────────
  DesktopAuth: "color: #f97316; font-weight: bold", // orange
  DesktopLogin: "color: #fb923c; font-weight: bold", // light orange
  DesktopDeepLinkBridge: "color: #ea580c; font-weight: bold", // dark orange
  DesktopDevtools: "color: #c2410c; font-weight: bold", // burnt orange
  DesktopSettings: "color: #dba758; font-weight: bold", // gold
  "Desktop Shim": "color: #b45309; font-weight: bold", // amber-dark
  // ── Sign-in / Bridge tags ─────────────────────────────────────────────
  SignInBridge: "color: #10b981; font-weight: bold", // emerald
  // ── Embed tags ────────────────────────────────────────────────────────
  EmbedFetcher: "color: #8b5cf6; font-weight: bold", // violet
  "embed:twitter": "color: #6366f1; font-weight: bold", // indigo
  embed: "color: #7c3aed; font-weight: bold", // purple-dark
  // ── API / Network tags ────────────────────────────────────────────────
  "api-client": "color: #0ea5e9; font-weight: bold", // sky
  "requireAuth": "color: #e11d48; font-weight: bold", // rose
  broadcast: "color: #d946ef; font-weight: bold", // fuchsia
  notifications: "color: #f43f5e; font-weight: bold", // pink
  "presence.service": "color: #ec4899; font-weight: bold", // pink-light
  // ── Capture / Share tags ──────────────────────────────────────────────
  ScreenShare: "color: #14b8a6; font-weight: bold", // teal
  ScreenPicker: "color: #0d9488; font-weight: bold", // teal-dark
  "Voice:Devices": "color: #06b6d4; font-weight: bold", // cyan
  Preview: "color: #22d3ee; font-weight: bold", // cyan-light
  useNativeShareStats: "color: #0891b2; font-weight: bold", // cyan-dark
  // ── Misc tags ─────────────────────────────────────────────────────────
  Mod: "color: #ef4444; font-weight: bold", // red
  MicTest: "color: #f472b6; font-weight: bold", // pink
  VoiceDetails: "color: #a78bfa; font-weight: bold", // violet-light
  VoiceDebug: "color: #818cf8; font-weight: bold", // indigo-light
  UpdateChecker: "color: #34d399; font-weight: bold", // emerald-light
  Settings: "color: #fbbf24; font-weight: bold", // amber-light
  Profile: "color: #fb7185; font-weight: bold", // rose-light
  VirtualMessageList: "color: #94a3b8; font-weight: bold", // slate
  MemberList: "color: #64748b; font-weight: bold", // slate-dark
  VideoAttachment: "color: #475569; font-weight: bold", // slate-darker
  ChatScroll: "color: #6b7280; font-weight: bold", // gray
  cache: "color: #a3a3a3; font-weight: bold", // neutral
  "Audit Logger": "color: #dc2626; font-weight: bold", // red-dark
  RateLimiterDO: "color: #b91c1c; font-weight: bold", // red-darker
  platform: "color: #78716c; font-weight: bold", // stone
  "proxy-media": "color: #737373; font-weight: bold", // neutral-dark
};

const TIMESTAMP_STYLE = "color: #6b7280; font-weight: normal"; // gray
const RESET_STYLE = "color: inherit; font-weight: normal";

let colorIndex = 0;
const FALLBACK_HUES = [330, 200, 30, 160, 280, 60, 350, 120]; // spread across hue wheel

function serializeArg(arg: unknown): unknown {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg !== "object") return arg;
  if (arg instanceof Error) {
    return JSON.stringify({
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    });
  }

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(arg, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  } catch {
    return String(arg);
  }
}

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
    const serializedArgs = args.map(serializeArg);
    // Format: [+0.123s] [Tag] message  ...extraArgs
    fn(
      `%c[${elapsed()}]%c [${tag}]%c ${msg}`,
      TIMESTAMP_STYLE,
      tagStyle,
      RESET_STYLE,
      ...serializedArgs,
    );
  }

  return {
    debug: (msg, ...args) => emit(console.debug, msg, args),
    info: (msg, ...args) => emit(console.log, msg, args),
    warn: (msg, ...args) => emit(console.warn, msg, args),
    error: (msg, ...args) => emit(console.error, msg, args),
  };
}
