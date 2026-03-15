// ============================================================================
// VoiceActivityDetector — VAD analysis + noise gate for push transceivers
// ============================================================================

import { SpeakingFlags } from "../types";

const DEBUG = typeof import.meta !== "undefined" && import.meta.env?.DEV;

/** Callbacks from the VAD to the owning SFUClient */
export interface VADCallbacks {
  /** Emit speaking / vad-speaking events */
  onSpeakingChange(isSpeaking: boolean, speakingFlags: number): void;
  /** Send speaking state over the voice WebSocket */
  sendSpeaking(flags: number): void;
  /** Get the push audio transceiver for noise gating */
  getAudioTransceiver(): RTCRtpTransceiver | undefined;
  /** Get the current participant ID (null if not yet joined) */
  getParticipantId(): string | null;
}

export class VoiceActivityDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isSpeaking: boolean = false;
  private silenceStart: number = 0;
  private threshold: number = 3; // RMS threshold (roughly 0-100 scale)
  private silenceDelay: number = 300; // ms of silence before "stopped speaking"
  private gateEnabled: boolean = false;
  private isGated: boolean = false; // tracks whether gate is currently applied
  private contextResumed: boolean = false; // avoid spamming resume()
  private lastRms: number = 0; // last computed RMS for live UI feedback

  private readonly callbacks: VADCallbacks;

  constructor(callbacks: VADCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Start VAD on a local audio stream.
   */
  start(stream: MediaStream): void {
    this.stop();

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.3;

      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);

      // Explicitly resume in case it's suspended
      this.contextResumed = false;
      this.audioContext.resume().catch(() => { });

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      this.timer = setInterval(() => {
        if (!this.analyser || !this.audioContext) return;

        // Auto-resume: Chrome suspends AudioContexts created before user
        // gesture. Try to resume every tick until it succeeds. Once the
        // user has interacted with the page, resume() will work.
        if (!this.contextResumed && this.audioContext.state === 'suspended') {
          this.audioContext.resume().then(() => {
            this.contextResumed = true;
            if (DEBUG) console.log("[VAD] AudioContext resumed");
          }).catch(() => { });
          return; // skip this tick — data is stale while suspended
        }
        if (this.audioContext.state === 'running') {
          this.contextResumed = true;
        }

        this.analyser.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128.0;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length) * 100;
        this.lastRms = rms;
        const now = Date.now();

        if (rms >= this.threshold) {
          // Speaking
          this.silenceStart = 0;
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            if (this.gateEnabled) {
              this.applyGate(false);
            }
            const pid = this.callbacks.getParticipantId();
            if (pid) {
              this.callbacks.onSpeakingChange(true, SpeakingFlags.MICROPHONE);
              this.callbacks.sendSpeaking(SpeakingFlags.MICROPHONE);
            }
          }
        } else {
          // Silence
          if (this.isSpeaking) {
            if (this.silenceStart === 0) {
              this.silenceStart = now;
            } else if (now - this.silenceStart >= this.silenceDelay) {
              this.isSpeaking = false;
              if (this.gateEnabled) {
                this.applyGate(true);
              }
              const pid = this.callbacks.getParticipantId();
              if (pid) {
                this.callbacks.onSpeakingChange(false, SpeakingFlags.NONE);
                this.callbacks.sendSpeaking(0);
              }
            }
          }
        }
      }, 50);

      if (DEBUG) console.log("[VAD] Started voice activity detection");
    } catch (err) {
      console.error("[VAD] Failed to start:", err);
    }
  }

  /**
   * Called by SFUClient when the push audio transceiver becomes ready
   * (after NegotiationDone). This is the reliable point to apply the gate
   * because the transceiver is guaranteed to exist and have encodings.
   *
   * We reset isGated first because a renegotiation (track replacement)
   * resets `encoding.active` to true on the browser side. Without this
   * reset, the no-op guard in applyGate() would skip reapplying the gate.
   *
   * IMPORTANT: We delay the initial gate by 2s so the track has time to
   * establish on the SFU. Cloudflare Calls interprets encoding.active=false
   * on a track with no active receivers as "track dead" and sends StopTracks
   * to other participants — permanently killing audio. This race condition
   * occurs during simultaneous joins (calls) where both users publish
   * and gate before the other has pulled the track.
   */
  onTransceiverReady(): void {
    this.isGated = false;
    if (this.gateEnabled && !this.isSpeaking) {
      // Delay the initial gate to ensure ICE has connected, RTP has started
      // flowing, and remote participants have had a chance to pull this track.
      setTimeout(() => {
        // Re-check — user might have started speaking during the delay
        if (this.gateEnabled && !this.isSpeaking && !this.isGated) {
          if (DEBUG) console.log("[VAD] Transceiver ready — applying delayed gate");
          this.applyGate(true);
        }
      }, 2000);
    }
  }

  /**
   * Stop VAD monitoring. Call when mic is turned off or leaving.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => { });
      this.audioContext = null;
    }
    this.analyser = null;
    this.contextResumed = false;
    if (this.isSpeaking) {
      this.isSpeaking = false;
      const pid = this.callbacks.getParticipantId();
      if (pid) {
        this.callbacks.onSpeakingChange(false, SpeakingFlags.NONE);
        this.callbacks.sendSpeaking(0);
      }
    }
  }

  /**
   * Update VAD threshold dynamically.
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
    if (DEBUG) console.log("[VAD] Threshold updated to:", threshold);
  }

  /**
   * Resume the VAD's AudioContext after a user gesture.
   */
  resumeContext(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        this.contextResumed = true;
        if (DEBUG) console.log("[VAD] AudioContext resumed");
      }).catch(() => { });
    }
  }

  /**
   * Enable noise gate — when active, audio below the VAD threshold is muted
   * on the push transceiver so others don't hear background noise.
   */
  enableNoiseGate(): void {
    this.gateEnabled = true;
    if (!this.isSpeaking) {
      this.applyGate(true);
    }
    if (DEBUG) console.log("[VAD] Noise gate enabled");
  }

  /**
   * Disable noise gate — all audio passes through regardless of VAD state.
   */
  disableNoiseGate(): void {
    this.gateEnabled = false;
    this.applyGate(false);
    if (DEBUG) console.log("[VAD] Noise gate disabled");
  }

  /**
   * Gate/ungate the push audio transceiver by toggling encoding.active.
   *
   * We CANNOT use `track.enabled = false` — the VAD reads from the same
   * MediaStreamTrack. Disabling it feeds silence to the analyser, permanently
   * blinding the VAD from detecting speech to ungate.
   */
  private applyGate(gated: boolean): void {
    if (this.isGated === gated) return;

    const transceiver = this.callbacks.getAudioTransceiver();
    if (!transceiver?.sender) {
      if (DEBUG) console.log(`[VAD] Gate deferred: no transceiver (pid=${this.callbacks.getParticipantId()})`);
      return;
    }

    try {
      const params = transceiver.sender.getParameters();
      if (params.encodings && params.encodings.length > 0) {
        params.encodings[0].active = !gated;
        transceiver.sender.setParameters(params).catch(() => { });
      }
    } catch { /* setParameters not supported */ }

    this.isGated = gated;
    if (DEBUG) console.log(`[VAD] Audio gate ${gated ? "ON ■ (silence)" : "OFF ▶ (speaking)"}`);
  }

  /** Get the most recent RMS level (0-100 scale) for live UI feedback. */
  getCurrentRMS(): number {
    return this.lastRms;
  }

  /** Get the current threshold for UI display. */
  getThreshold(): number {
    return this.threshold;
  }

  /** Dispose all resources. */
  dispose(): void {
    this.stop();
  }
}
