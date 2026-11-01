import { clog } from "@/lib/console-logger";
import { markVoice } from "@/lib/voice/latency-marks";

const captureLog = clog("Voice:Capture");

// ============================================================================
// Capture AudioContext — one shared, refcounted context for outbound audio
// processing (noise gate, RNNoise, mic tests).
//
// Browsers start an AudioContext suspended unless it is created or resumed
// during a user gesture, and a suspended context renders nothing: a gated
// microphone built on it publishes silence. prewarmCaptureAudioContext() is
// called from the voice-join / call click (via prewarmAudioContext), so the
// processor built moments later adopts a running context. Device swaps keep
// it alive (the next processor is acquired before the previous one is
// released), so they never land on a fresh, suspended context.
// ============================================================================

export const CAPTURE_SAMPLE_RATE = 48_000;
const PREWARM_HOLD_MS = 10_000;

let sharedContext: AudioContext | null = null;
let users = 0;
let prewarmTimer: ReturnType<typeof setTimeout> | null = null;
const moduleLoads = new WeakMap<AudioContext, Map<string, Promise<void>>>();

function createCaptureContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  try {
    return new AudioContext({
      latencyHint: "interactive",
      sampleRate: CAPTURE_SAMPLE_RATE,
    });
  } catch {
    return null;
  }
}

function ensureSharedContext(): AudioContext | null {
  if (sharedContext && sharedContext.state !== "closed") return sharedContext;
  sharedContext = createCaptureContext();
  if (sharedContext) {
    const context = sharedContext;
    context.addEventListener?.("statechange", () => {
      if (context === sharedContext) {
        localAudioDiagnostics.captureContextState = context.state;
      }
    });
    localAudioDiagnostics.captureContextState = context.state;
  }
  return sharedContext;
}

function closeIfUnused(): void {
  if (users > 0 || prewarmTimer !== null) return;
  const context = sharedContext;
  sharedContext = null;
  localAudioDiagnostics.captureContextState = null;
  if (context && context.state !== "closed") context.close().catch(() => {});
}

/** Take a reference to the shared capture context (null: unavailable). */
export function acquireCaptureAudioContext(): AudioContext | null {
  const context = ensureSharedContext();
  if (!context) return null;
  users += 1;
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
}

/** Drop a reference taken with acquireCaptureAudioContext(). */
export function releaseCaptureAudioContext(context: AudioContext): void {
  if (context !== sharedContext) {
    if (context.state !== "closed") context.close().catch(() => {});
    return;
  }
  users = Math.max(0, users - 1);
  closeIfUnused();
}

/**
 * Create (or wake) the shared capture context inside a user gesture and hold
 * it briefly for the processor the join is about to build. Also starts
 * loading `moduleUrls` so the gate worklet is ready by then.
 */
export function prewarmCaptureAudioContext(moduleUrls: string[] = []): void {
  const context = ensureSharedContext();
  if (!context) return;
  if (context.state === "suspended") context.resume().catch(() => {});
  if (prewarmTimer !== null) clearTimeout(prewarmTimer);
  prewarmTimer = setTimeout(() => {
    prewarmTimer = null;
    closeIfUnused();
  }, PREWARM_HOLD_MS);
  for (const url of moduleUrls) {
    void loadCaptureWorkletModule(context, url).catch(() => {});
  }
}

/** addModule() once per context and URL. */
export function loadCaptureWorkletModule(
  context: AudioContext,
  url: string,
): Promise<void> {
  let loads = moduleLoads.get(context);
  if (!loads) {
    loads = new Map();
    moduleLoads.set(context, loads);
  }
  let load = loads.get(url);
  if (!load) {
    load =
      typeof context.audioWorklet?.addModule === "function"
        ? context.audioWorklet.addModule(url)
        : Promise.reject(new Error("AudioWorklet is unavailable"));
    loads.set(url, load);
    load.catch(() => loads?.delete(url));
  }
  return load;
}

// ── Diagnostics ─────────────────────────────────────────────────────────

export type LocalAudioIssue =
  | "capture-context-unavailable"
  | "capture-context-suspended"
  | "gate-unavailable"
  | "processor-unavailable";

export type LocalAudioPublication =
  | "direct"
  | "passthrough"
  | "true-stereo"
  | "rnnoise";

interface LocalAudioDiagnostics {
  captureContextState: AudioContextState | null;
  publication: LocalAudioPublication | null;
  gated: boolean;
  gateLookaheadMs: number | null;
  issues: Partial<Record<LocalAudioIssue, { count: number; detail?: string }>>;
}

const localAudioDiagnostics: LocalAudioDiagnostics = {
  captureContextState: null,
  publication: null,
  gated: false,
  gateLookaheadMs: null,
  issues: {},
};

/**
 * Record a local audio problem. The first occurrence of each issue is logged
 * (and marked for the latency bench); all are counted for diagnostics.
 */
export function reportLocalAudioIssue(
  issue: LocalAudioIssue,
  detail?: string,
): void {
  const entry = localAudioDiagnostics.issues[issue];
  if (entry) {
    entry.count += 1;
    if (detail) entry.detail = detail;
    return;
  }
  localAudioDiagnostics.issues[issue] = { count: 1, detail };
  captureLog.warn(`Local audio issue: ${issue}`, detail ?? "");
  markVoice("local-audio-issue", { issue, detail });
}

/** Record what the microphone publication currently is. */
export function noteLocalAudioPublication(
  publication: LocalAudioPublication,
  gate: { gated: boolean; lookaheadMs: number | null },
): void {
  localAudioDiagnostics.publication = publication;
  localAudioDiagnostics.gated = gate.gated;
  localAudioDiagnostics.gateLookaheadMs = gate.lookaheadMs;
  if (sharedContext) {
    localAudioDiagnostics.captureContextState = sharedContext.state;
  }
  markVoice("mic-publication", {
    publication,
    gated: gate.gated,
    lookaheadMs: gate.lookaheadMs,
    captureContextState: localAudioDiagnostics.captureContextState,
  });
}

export function isCaptureAudioContextSuspended(): boolean {
  return users > 0 && sharedContext?.state === "suspended";
}

export function getLocalAudioDiagnostics(): LocalAudioDiagnostics {
  return {
    ...localAudioDiagnostics,
    captureContextState:
      sharedContext?.state ?? localAudioDiagnostics.captureContextState,
    issues: { ...localAudioDiagnostics.issues },
  };
}

export function resetCaptureAudioContextForTests(): void {
  if (prewarmTimer !== null) clearTimeout(prewarmTimer);
  prewarmTimer = null;
  users = 0;
  sharedContext = null;
  localAudioDiagnostics.captureContextState = null;
  localAudioDiagnostics.publication = null;
  localAudioDiagnostics.gated = false;
  localAudioDiagnostics.gateLookaheadMs = null;
  localAudioDiagnostics.issues = {};
}
