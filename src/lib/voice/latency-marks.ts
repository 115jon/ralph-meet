/**
 * User Timing marks for the voice join path (`voice:<stage>`).
 *
 * `scripts/voice-latency` reads them with
 * `performance.getEntriesByName(...)` to build a per-stage waterfall, and they
 * show up in the DevTools Performance panel's Timings track. A mark is a
 * single buffered entry, so this costs nothing at idle and next to nothing
 * per join. The buffer is trimmed so a long session cannot grow it forever.
 */

export const VOICE_MARK_PREFIX = "voice:";
const MAX_VOICE_MARKS = 600;

let markCount = 0;

export function markVoice(stage: string, detail?: Record<string, unknown>) {
  if (typeof performance === "undefined" || !performance.mark) return;
  try {
    if (++markCount > MAX_VOICE_MARKS) {
      for (const entry of performance.getEntriesByType("mark")) {
        if (entry.name.startsWith(VOICE_MARK_PREFIX)) {
          performance.clearMarks(entry.name);
        }
      }
      markCount = 1;
    }
    performance.mark(`${VOICE_MARK_PREFIX}${stage}`, { detail });
  } catch {
    // An uncloneable detail or a missing User Timing API is not worth a throw.
  }
}

export function resetVoiceMarkCountForTests(): void {
  markCount = 0;
}
