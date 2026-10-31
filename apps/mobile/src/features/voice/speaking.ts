// The local speaking signal. The web runs a VAD on the microphone in an
// AudioWorklet (src/lib/voice/vad.ts) and sends Speaking flags on the voice
// socket; the server only relays them, so a client that sends none never
// lights up for anyone. React Native has no Web Audio, so this reads the
// microphone level WebRTC already measures: the sender's media-source
// audioLevel (0..1), polled a few times a second, nothing per frame.

const POLL_MS = 250;
/** Level that counts as voice; quiet rooms sit near 0.001-0.01. */
const START_LEVEL = 0.035;
/** Silence this long ends a burst, so pauses between words do not flicker. */
const HOLD_MS = 600;

interface AudioLevelStat {
  readonly type?: unknown;
  readonly kind?: unknown;
  readonly audioLevel?: unknown;
}

function readAudioLevel(report: Iterable<[string, unknown]>): number | null {
  for (const [, value] of report) {
    const stat = value as AudioLevelStat;
    if (
      stat.type === "media-source" &&
      stat.kind === "audio" &&
      typeof stat.audioLevel === "number"
    ) {
      return stat.audioLevel;
    }
  }
  return null;
}

export interface SpeakingDetectorOptions {
  /** The microphone's sender now, or null (not published, muted). */
  readonly sender: () => RTCRtpSender | null;
  readonly onChange: (speaking: boolean) => void;
}

/** Polls until the returned stop() is called. */
export function startSpeakingDetector({
  sender,
  onChange,
}: SpeakingDetectorOptions): () => void {
  let speaking = false;
  let lastVoiceAt = 0;
  let inFlight = false;
  let stopped = false;

  const set = (next: boolean) => {
    if (next === speaking) return;
    speaking = next;
    onChange(next);
  };

  const tick = async () => {
    const current = sender();
    if (!current) {
      set(false);
      return;
    }
    if (inFlight) return;
    inFlight = true;
    try {
      const report = (await current.getStats()) as unknown as Iterable<
        [string, unknown]
      >;
      if (stopped) return;
      const level = readAudioLevel(report);
      const now = Date.now();
      if (level !== null && level >= START_LEVEL) {
        lastVoiceAt = now;
        set(true);
      } else if (now - lastVoiceAt >= HOLD_MS) {
        set(false);
      }
    } catch {
      // A sender mid-replacement; the next tick reads the new one.
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void tick(), POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    set(false);
  };
}
