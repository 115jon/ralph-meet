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
  private gateOriginalTrack: MediaStreamTrack | null = null;
  private silenceDelay: number = 300; // ms of silence before "stopped speaking"
  private gateEnabled: boolean = false;

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
              this.setLocalAudioGated(false);
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
              // Noise gate: mute the push transceiver so others don't hear background noise
              if (this.gateEnabled) {
                this.setLocalAudioGated(true);
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

      console.log("[VAD] Started voice activity detection");
    } catch (err) {
      console.error("[VAD] Failed to start:", err);
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
    this.gateOriginalTrack = null;
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
   * Enable noise gate — when active, audio below the VAD threshold is muted
   * on the push transceiver so others don't hear background noise.
   */
  enableNoiseGate(): void {
    this.gateEnabled = true;
    // If not currently speaking, gate immediately
    if (!this.isSpeaking) {
      this.setLocalAudioGated(true);
    }
    console.log("[VAD] Noise gate enabled");
  }

  /**
   * Disable noise gate — all audio passes through regardless of VAD state.
   */
  disableNoiseGate(): void {
    this.gateEnabled = false;
    this.setLocalAudioGated(false);
    this.gateOriginalTrack = null;
    console.log("[VAD] Noise gate disabled");
  }

  /**
   * Gate/ungate the push audio transceiver using replaceTrack.
   * - gated=true  → replaceTrack(null) sends silence frames while keeping
   *   the original track alive for the VAD analyser.
   * - gated=false → replaceTrack(originalTrack) restores outgoing audio.
   */
  private setLocalAudioGated(gated: boolean): void {
    const transceiver = this.callbacks.getAudioTransceiver();
    if (!transceiver?.sender) return;

    if (gated) {
      // Save the original track before nulling
      if (transceiver.sender.track && !this.gateOriginalTrack) {
        this.gateOriginalTrack = transceiver.sender.track;
      }
      transceiver.sender.replaceTrack(null).catch(() => { });
    } else {
      // Restore the original track
      if (this.gateOriginalTrack) {
        transceiver.sender.replaceTrack(this.gateOriginalTrack).catch(() => { });
      }
    }
  }

  /** Dispose all resources. */
  dispose(): void {
    this.stop();
  }
}
