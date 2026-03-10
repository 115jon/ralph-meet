// ============================================================================
// Sound Effects Engine — Web Audio API
//
// All sounds are synthesised on-the-fly using oscillators and noise buffers.
// This avoids bundling audio files and works identically in the browser,
// CEF (desktop Tauri), and any ServiceWorker-free environment.
// ============================================================================

let _ctx: AudioContext | null = null;
let _interactionCallback: (() => void) | null = null;

function ctx(): AudioContext {
  if (!_ctx || _ctx.state === "closed") {
    _ctx = new AudioContext();
  }
  // Resume suspended context (autoplay policy)
  if (_ctx.state === "suspended") {
    _ctx.resume().catch(() => { });
    // Notify UI that interaction is needed
    if (_interactionCallback) _interactionCallback();
  }
  return _ctx;
}

/** Check if the sound AudioContext is suspended (needs user interaction) */
export function isSoundContextSuspended(): boolean {
  return !!_ctx && _ctx.state === "suspended";
}

/** Resume the sound AudioContext after a user gesture */
export function resumeSoundContext(): Promise<void> {
  if (!_ctx) _ctx = new AudioContext();
  return _ctx.resume();
}

/**
 * Register a callback fired when a sound tries to play but the AudioContext
 * is suspended. Use this to show an "Interaction Required" popup.
 */
export function onSoundInteractionNeeded(cb: (() => void) | null) {
  _interactionCallback = cb;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a gain node that fades out over `duration` seconds */
function fadeOut(a: AudioContext, startGain: number, duration: number): GainNode {
  const g = a.createGain();
  g.gain.setValueAtTime(startGain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + duration);
  return g;
}

/** Play a tone burst: freq (Hz), duration (s), volume 0-1, type */
function tone(
  freq: number,
  duration: number,
  volume = 0.15,
  type: OscillatorType = "sine",
  delay = 0
) {
  const a = ctx();
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime + delay);

  const g = a.createGain();
  g.gain.setValueAtTime(0, a.currentTime + delay);
  // Quick attack
  g.gain.linearRampToValueAtTime(volume, a.currentTime + delay + 0.01);
  // Smooth decay
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + delay + duration);

  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + delay);
  osc.stop(a.currentTime + delay + duration + 0.05);
}

/** Play two tones in sequence (ascending = join-like, descending = leave-like) */
function twoTone(f1: number, f2: number, dur = 0.1, gap = 0.08, volume = 0.12) {
  tone(f1, dur, volume, "sine", 0);
  tone(f2, dur, volume, "sine", dur + gap);
}

/** Short click/pop for mute/unmute */
function clickPop(freq: number, volume = 0.1) {
  const a = ctx();
  const osc = a.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, a.currentTime);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, a.currentTime + 0.06);

  const g = a.createGain();
  g.gain.setValueAtTime(volume, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.06);

  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime);
  osc.stop(a.currentTime + 0.08);
}

/** Soft chime for notifications (richer timbre using harmonics) */
function chime(baseFreq: number, duration = 0.4, volume = 0.08) {
  const a = ctx();
  const now = a.currentTime;

  // Fundamental
  const osc1 = a.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = baseFreq;

  // Octave harmonic (soft)
  const osc2 = a.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = baseFreq * 2;

  // Fifth harmonic (very soft)
  const osc3 = a.createOscillator();
  osc3.type = "sine";
  osc3.frequency.value = baseFreq * 1.5;

  const master = a.createGain();
  master.gain.setValueAtTime(volume, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const g1 = a.createGain();
  g1.gain.value = 1.0;
  const g2 = a.createGain();
  g2.gain.value = 0.3;
  const g3 = a.createGain();
  g3.gain.value = 0.15;

  osc1.connect(g1).connect(master);
  osc2.connect(g2).connect(master);
  osc3.connect(g3).connect(master);
  master.connect(a.destination);

  osc1.start(now);
  osc2.start(now);
  osc3.start(now);
  osc1.stop(now + duration + 0.05);
  osc2.stop(now + duration + 0.05);
  osc3.stop(now + duration + 0.05);
}


// ── Public Sound Effects ────────────────────────────────────────────────────

/** Discord-style ascending two-tone: someone joined voice */
export function playVoiceJoin() {
  twoTone(880, 1175, 0.08, 0.06, 0.12);
}

/** Discord-style descending two-tone: someone left voice */
export function playVoiceLeave() {
  twoTone(1175, 880, 0.08, 0.06, 0.12);
}

/** Short pop — microphone muted */
export function playMute() {
  clickPop(400, 0.12);
}

/** Short pop (higher) — microphone unmuted */
export function playUnmute() {
  clickPop(600, 0.12);
}

/** Lower pop — deafened */
export function playDeafen() {
  clickPop(300, 0.14);
}

/** Higher pop — undeafened */
export function playUndeafen() {
  clickPop(700, 0.12);
}

/** Soft chime — new notification (mention, reply, DM) */
export function playNotification() {
  chime(1047, 0.35, 0.1);   // C6
  setTimeout(() => chime(1319, 0.3, 0.07), 120); // E6
}

/** Subtle knock — new message in current channel */
export function playMessageReceived() {
  const a = ctx();
  const now = a.currentTime;
  const osc = a.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);

  const g = a.createGain();
  g.gain.setValueAtTime(0.06, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  osc.connect(g).connect(a.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

/** Warm disconnect tone — you disconnected from voice */
export function playDisconnect() {
  const a = ctx();
  const now = a.currentTime;

  const osc = a.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(523, now);  // C5
  osc.frequency.exponentialRampToValueAtTime(330, now + 0.2); // E4

  const g = a.createGain();
  g.gain.setValueAtTime(0.12, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(g).connect(a.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

/** Three-tone connection chime — you connected to voice */
export function playConnected() {
  tone(523, 0.1, 0.1, "sine", 0);       // C5
  tone(659, 0.1, 0.1, "sine", 0.1);     // E5
  tone(784, 0.15, 0.1, "sine", 0.2);    // G5
}

/** Incoming call ring — repeated chime pattern */
let ringInterval: ReturnType<typeof setInterval> | null = null;

export function playRingStart() {
  playRingStop();
  const ringOnce = () => {
    chime(880, 0.2, 0.08);
    setTimeout(() => chime(1047, 0.2, 0.08), 200);
    setTimeout(() => chime(880, 0.2, 0.06), 400);
  };
  ringOnce();
  ringInterval = setInterval(ringOnce, 2500);
}

export function playRingStop() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
}

/** Screen share started */
export function playScreenShareStart() {
  tone(660, 0.08, 0.08, "sine", 0);
  tone(880, 0.12, 0.08, "sine", 0.1);
}

/** Screen share stopped */
export function playScreenShareStop() {
  tone(880, 0.08, 0.08, "sine", 0);
  tone(660, 0.12, 0.08, "sine", 0.1);
}
