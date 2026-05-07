import { clog } from "@/lib/console-logger";

const vadLog = clog("VAD");
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
  /** Fired when RMS stays exactly 0 for 5 seconds */
  onAudioStalled?(isStalled: boolean): void;
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
  private gracePeriodEnd: number = 0; // Don't gate before this timestamp
  private pureSilenceStart: number = 0; // Timestamp when RMS hit exactly 0
  private isStalled: boolean = false; // True if RMS is exactly 0 for > 5s

  private readonly callbacks: VADCallbacks;

  constructor(callbacks: VADCallbacks) {
    this.callbacks = callbacks;
  }

  private vadTrack: MediaStreamTrack | null = null;

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

      // Firefox BUG WORKAROUND:
      // Passing the raw MediaStream to createMediaStreamSource while the AudioContext
      // is suspended (e.g. autoplay policy) will silently mute the original track for WebRTC.
      // We MUST clone the track and use a dedicated stream for the AudioContext.
      this.vadTrack = audioTrack.clone();
      const vadStream = new MediaStream([this.vadTrack]);

      this.source = this.audioContext.createMediaStreamSource(vadStream);
      this.source.connect(this.analyser);

      // Explicitly resume in case it's suspended
      this.contextResumed = false;
      this.audioContext.resume().catch(() => { });

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      // Listen for context state changes so we can apply the pending gate
      // when the context transitions to 'running' (user gesture on Firefox).
      this.audioContext.addEventListener('statechange', () => {
        if (this.audioContext?.state === 'running' && !this.contextResumed) {
          this.contextResumed = true;
          if (DEBUG) vadLog.info("AudioContext resumed via statechange");
          // Now that we can actually detect speech, apply the pending gate
          // state. If the user IS speaking we'll detect it on the next tick
          // and un-gate. If they're silent, the gate activates correctly.
          if (this.gateEnabled && !this.isSpeaking) {
            this.applyGate(true);
          }
        }
      });

      this.timer = setInterval(() => {
        if (!this.analyser || !this.audioContext) return;

        // Auto-resume: Chrome suspends AudioContexts created before user
        // gesture. Try to resume every tick until it succeeds. Once the
        // user has interacted with the page, resume() will work.
        if (!this.contextResumed && this.audioContext.state === 'suspended') {
          this.audioContext.resume().then(() => {
            this.contextResumed = true;
            if (DEBUG) vadLog.info("AudioContext resumed");
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

        if (rms === 0) {
          if (this.pureSilenceStart === 0) {
            this.pureSilenceStart = now;
          } else if (!this.isStalled && now - this.pureSilenceStart >= 5000) {
            this.isStalled = true;
            this.callbacks.onAudioStalled?.(true);
            if (DEBUG) vadLog.warn("Audio hardware stalled: 0 RMS straight for 5s");
          }
        } else {
          this.pureSilenceStart = 0;
          if (this.isStalled) {
            this.isStalled = false;
            this.callbacks.onAudioStalled?.(false);
            if (DEBUG) vadLog.info("Audio hardware recovered: Non-zero RMS detected");
          }
        }

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

      if (DEBUG) vadLog.info("Started voice activity detection");
    } catch (err) {
      vadLog.error("Failed to start:", err);
    }
  }

  /**
   * Called by SFUClient when the push audio transceiver becomes ready
   * (after NegotiationDone). For long-lived Cloudflare Realtime tracks we keep
   * the RTP sender active even during silence, because the SFU garbage-collects
   * tracks after a period with no received media packets.
   */
  onTransceiverReady(): void {
    this.isGated = false;
    // Only gate immediately if the VAD AudioContext is running — otherwise
    // we can't detect speech and the gate would stay ON permanently on
    // Firefox autoJoin (suspended context, no user gesture).
    if (this.gateEnabled && !this.isSpeaking && this.contextResumed) {
      if (DEBUG) vadLog.info("Transceiver ready — applying initial gate");
      this.applyGate(true);
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
    if (this.vadTrack) {
      this.vadTrack.stop();
      this.vadTrack = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => { });
      this.audioContext = null;
    }
    this.analyser = null;
    this.contextResumed = false;
    this.pureSilenceStart = 0;

    if (this.isStalled) {
      this.isStalled = false;
      this.callbacks.onAudioStalled?.(false);
    }

    // Explicitly apply the mute gate to the tracked clone so the
    // SFU actually receives DTX silence when the user hits "Mute"
    this.applyGate(true);

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
    if (DEBUG) vadLog.info("Threshold updated to:", threshold);
  }

  /**
   * Resume the VAD's AudioContext after a user gesture.
   */
  resumeContext(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        this.contextResumed = true;
        if (DEBUG) vadLog.info("AudioContext resumed");
      }).catch(() => { });
    }
  }

  /**
   * Enable noise gate — when active, audio below the VAD threshold is muted
   * on the push transceiver so others don't hear background noise.
   *
   * IMPORTANT: We only activate the gate immediately if the VAD AudioContext
   * is confirmed running. On Firefox autoJoin (no user gesture), the context
   * starts suspended → the VAD can't detect speech → the gate would stay ON
   * forever, permanently silencing outgoing RTP. When the context eventually
   * resumes (user gesture), the statechange listener applies the gate.
   */
  enableNoiseGate(): void {
    this.gateEnabled = true;
    if (!this.isSpeaking && this.contextResumed) {
      this.applyGate(true);
    }
    if (DEBUG) vadLog.info("Noise gate enabled");
  }

  /**
   * Disable noise gate — all audio passes through regardless of VAD state.
   */
  disableNoiseGate(): void {
    this.gateEnabled = false;
    this.applyGate(false);
    if (DEBUG) vadLog.info("Noise gate disabled");
  }

  private applyGate(gated: boolean): void {
    if (this.isGated === gated) return;

    const transceiver = this.callbacks.getAudioTransceiver();
    if (!transceiver) {
      if (DEBUG) vadLog.info(`Gate deferred: no transceiver (pid=${this.callbacks.getParticipantId()})`);
      return;
    }

    // Do not set RTCRtpEncodingParameters.active=false here. That stops RTP
    // entirely on Chromium, which can make Cloudflare Realtime consider a live
    // audio track inactive and garbage-collect it. VAD now drives speaking state
    // only; user mute still uses MediaStreamTrack.enabled.
    this.isGated = gated;
    if (DEBUG) vadLog.info(`Audio gate ${gated ? "ON ■ (silence)" : "OFF ▶ (speaking)"}`);
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
