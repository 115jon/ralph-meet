// ============================================================================
// VoiceActivityDetector — VAD analysis + noise gate for push transceivers
// ============================================================================

import { SpeakingFlags } from "../types";

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
      this.audioContext.resume().catch(() => { });

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      this.timer = setInterval(() => {
        if (!this.analyser) return;

        this.analyser.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128.0;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length) * 100;
        const now = Date.now();

        if (rms >= this.threshold) {
          // Speaking
          this.silenceStart = 0;
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            // Noise gate: unmute the push transceiver so others can hear
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
            // Was speaking → wait for silenceDelay before gating
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
          // Note: if isSpeaking is false and gateEnabled, the gate should already
          // be applied from onTransceiverReady() or enableNoiseGate(). No retry needed.
        }
      }, 50);

      console.log("[VAD] Started voice activity detection");
    } catch (err) {
      console.error("[VAD] Failed to start:", err);
    }
  }

  /**
   * Called by SFUClient when the push audio transceiver becomes ready
   * (after NegotiationDone). This is the reliable point to apply the gate
   * because the transceiver is guaranteed to exist and have encodings.
   */
  onTransceiverReady(): void {
    if (this.gateEnabled && !this.isSpeaking) {
      console.log("[VAD] Transceiver ready — applying gate");
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
    if (this.audioContext) {
      this.audioContext.close().catch(() => { });
      this.audioContext = null;
    }
    this.analyser = null;
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
    console.log("[VAD] Threshold updated to:", threshold);
  }

  /**
   * Resume the VAD's AudioContext after a user gesture.
   * Chrome suspends AudioContexts created before user interaction.
   * Without this, getByteTimeDomainData returns all 128s (silence)
   * and the VAD can never detect speech.
   */
  resumeContext(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        console.log("[VAD] AudioContext resumed");
      }).catch(() => { });
    }
  }

  /**
   * Enable noise gate — when active, audio below the VAD threshold is muted
   * on the push transceiver so others don't hear background noise.
   */
  enableNoiseGate(): void {
    this.gateEnabled = true;
    // If not currently speaking, gate immediately (may no-op if transceiver
    // doesn't exist yet — onTransceiverReady() will handle that case).
    if (!this.isSpeaking) {
      this.applyGate(true);
    }
    console.log("[VAD] Noise gate enabled");
  }

  /**
   * Disable noise gate — all audio passes through regardless of VAD state.
   */
  disableNoiseGate(): void {
    this.gateEnabled = false;
    this.applyGate(false);
    console.log("[VAD] Noise gate disabled");
  }

  /**
   * Gate/ungate the push audio transceiver by toggling encoding.active
   * AND track.enabled.
   *
   * - gated=true  → encoding.active=false + track.enabled=false
   *   Combined with Opus DTX, this minimizes RTP to near-zero.
   * - gated=false → encoding.active=true + track.enabled=true
   *   Audio resumes instantly.
   */
  private applyGate(gated: boolean): void {
    if (this.isGated === gated) return; // no-op if already in desired state

    const transceiver = this.callbacks.getAudioTransceiver();
    if (!transceiver?.sender) {
      // Transceiver not found yet — onTransceiverReady() will handle this
      console.log(`[VAD] Gate deferred: no transceiver (pid=${this.callbacks.getParticipantId()})`);
      return;
    }

    const track = transceiver.sender.track;

    // We CANNOT use `track.enabled = false` here!
    // The VAD analyzes this exact same track. If we disable the track,
    // the VAD's input becomes silence, permanently blinding it from ever
    // detecting speech again (which explains why you couldn't ungate).

    // Method: encoding.active — tells the browser to stop/start encoding RTP.
    // Combined with Opus DTX, this produces near-zero traffic without blinding the VAD.
    try {
      const params = transceiver.sender.getParameters();
      if (params.encodings && params.encodings.length > 0) {
        params.encodings[0].active = !gated;
        transceiver.sender.setParameters(params).catch(() => { });
      }
    } catch { /* setParameters not supported on this browser */ }

    this.isGated = gated;
    console.log(`[VAD] Audio gate ${gated ? "ON ■ (silence)" : "OFF ▶ (speaking)"}`);
  }

  /** Dispose all resources. */
  dispose(): void {
    this.stop();
  }
}
