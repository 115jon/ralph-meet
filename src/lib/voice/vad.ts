import { clog } from "@/lib/console-logger";

const vadLog = clog("VAD");
// ============================================================================
// VoiceActivityDetector — RMS analysis + source gate controller
// ============================================================================

import { SpeakingFlags } from "../types";
import { VadCore } from "./vad-processor.worklet.js";

type VadEvent = { type: "speaking" | "stalled"; value: boolean };

/**
 * The AudioWorklet module (same file as VadCore). Vite emits it as a static
 * asset; the literal `new URL(..., import.meta.url)` form is what it rewrites.
 */
function vadWorkletUrl(): string {
  return new URL("./vad-processor.worklet.js", import.meta.url).href;
}

function canUseAudioWorklet(context: AudioContext): boolean {
  return (
    typeof AudioWorkletNode !== "undefined" &&
    typeof context.audioWorklet?.addModule === "function"
  );
}

const DEBUG = typeof import.meta !== "undefined" && import.meta.env?.DEV;
export function getVoiceActivityThreshold(
  autoSensitivity: boolean,
  sensitivity: number,
): number {
  if (autoSensitivity) return 3;

  const threshold = Math.pow(10, sensitivity / 20) * 100;
  return Math.max(Number.EPSILON, Math.min(100, threshold));
}

/** Map the VAD RMS scale back to the manual sensitivity slider position. */
export function getVoiceActivityLevelPercent(rms: number): number {
  if (rms <= 0) return 0;
  const decibels = 20 * Math.log10(rms / 100);
  return Math.max(0, Math.min(100, decibels + 100));
}

/** Calculate RMS from Web Audio time-domain samples in the VAD's 0..100 scale. */
export function calculateTimeDomainRms(
  data: Float32Array | Uint8Array,
): number {
  if (data.length === 0) return 0;

  if (data instanceof Float32Array) {
    let mean = 0;
    for (const sample of data) mean += sample;
    mean /= data.length;

    let sum = 0;
    for (const sample of data) {
      const centered = sample - mean;
      sum += centered * centered;
    }
    return Math.sqrt(sum / data.length) * 100;
  }

  let sum = 0;
  for (const sample of data) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length) * 100;
}

export interface VADGateController {
  setGated(gated: boolean): void;
  resume?(): void;
}

/** Callbacks from the VAD to the owning SFUClient */
export interface VADCallbacks {
  /** Emit speaking / voice-activity events */
  onSpeakingChange(isSpeaking: boolean, speakingFlags: number): void;
  /** Send speaking state over the voice WebSocket */
  sendSpeaking(flags: number): void;
  /** Retained for callers that also inspect the push transceiver. */
  getAudioTransceiver?(): RTCRtpTransceiver | undefined;
  /** Optional initial source gate. Replacements use setGateController(). */
  getAudioGate?(): VADGateController | null;
  /** Get the current participant ID (null if not yet joined) */
  getParticipantId(): string | null;
  /** Fired when RMS stays exactly 0 for 5 seconds */
  onAudioStalled?(isStalled: boolean): void;
}

export class VoiceActivityDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentOutput: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isSpeaking: boolean = false;
  private microphoneSpeaking = false;
  private soundboardSpeaking = false;
  private lastSentFlags = SpeakingFlags.NONE;
  private lastSentParticipantId: string | null = null;
  private lastEmittedParticipantId: string | null = null;
  private lifecycleGeneration = 0;
  private threshold = getVoiceActivityThreshold(true, -50);
  private silenceDelay: number = 300; // ms of silence before "stopped speaking"
  private gateEnabled: boolean = true;
  private isGated: boolean = false; // tracks whether gate is currently applied
  private gateController: VADGateController | null = null;
  private microphoneEnabled = true;
  private contextResumed: boolean = false; // avoid spamming resume()
  private lastRms: number = 0; // last computed RMS for live UI feedback
  private isStalled: boolean = false; // True if RMS is exactly 0 for > 5s
  // Speaking/stall hysteresis, shared by both paths (see vad-processor.worklet.js).
  private core: VadCore | null = null;
  // Worklet path: RMS and hysteresis run on the audio thread and only
  // transitions are posted here, so the main thread does not wake 20 times a
  // second and the gate is immune to background timer throttling. The
  // AnalyserNode + 50 ms timer path is the fallback (and covers the
  // suspended-context phase before the worklet takes over).
  private workletNode: AudioWorkletNode | null = null;
  private workletModuleReady: AudioContext | null = null;

  private readonly callbacks: VADCallbacks;

  constructor(callbacks: VADCallbacks) {
    this.callbacks = callbacks;
    this.gateController = callbacks.getAudioGate?.() ?? null;
  }

  /** Bind VAD gating to the currently published source gate. */
  setGateController(controller: VADGateController | null): void {
    this.gateController = controller;
    const desiredGated = this.getDesiredGateState();
    this.isGated = desiredGated;
    if (controller) controller.setGated(desiredGated);
  }

  private vadTrack: MediaStreamTrack | null = null;

  /**
   * Start RMS-based voice activity monitoring on a local audio stream.
   */
  start(stream: MediaStream): boolean {
    this.stop();
    const generation = ++this.lifecycleGeneration;

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return false;

    try {
      const context = new AudioContext();
      this.audioContext = context;
      const core = new VadCore({
        threshold: this.threshold,
        silenceDelayMs: this.silenceDelay,
      });
      this.core = core;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.3;

      // Firefox BUG WORKAROUND:
      // Passing the raw MediaStream to createMediaStreamSource while the AudioContext
      // is suspended (e.g. autoplay policy) will silently mute the original track for WebRTC.
      // We MUST clone the track and use a dedicated stream for the AudioContext.
      this.vadTrack = audioTrack.clone();
      const vadStream = new MediaStream([this.vadTrack]);

      this.source = context.createMediaStreamSource(vadStream);
      this.source.connect(this.analyser);

      // Keep the Web Audio graph rendering without routing microphone audio
      // back to the user. AnalyserNode data can remain stale when its output
      // is disconnected from the destination.
      this.silentOutput = context.createGain();
      this.silentOutput.gain.value = 0;
      this.analyser.connect(this.silentOutput);
      this.silentOutput.connect(context.destination);

      // Explicitly resume in case it's suspended
      this.contextResumed = false;
      context.resume().then(
        () => {
          if (
            this.lifecycleGeneration !== generation ||
            this.audioContext !== context
          )
            return;
          this.contextResumed = true;
          if (this.gateEnabled && !this.microphoneSpeaking) {
            this.applyGate(true);
          }
        },
        () => {},
      );

      const dataArray = new Float32Array(this.analyser.frequencyBinCount);

      // Listen for context state changes so we can apply the pending gate
      // when the context transitions to 'running' (user gesture on Firefox).
      context.addEventListener("statechange", () => {
        if (
          this.lifecycleGeneration !== generation ||
          this.audioContext !== context
        )
          return;
        if (context.state === "running" && !this.contextResumed) {
          this.contextResumed = true;
          if (DEBUG) vadLog.info("AudioContext resumed via statechange");
          // Now that we can actually detect speech, apply the pending gate
          // state. If the user IS speaking we'll detect it on the next tick
          // and un-gate. If they're silent, the gate activates correctly.
          if (this.gateEnabled && !this.microphoneSpeaking) {
            this.applyGate(true);
          }
        }
        if (context.state === "running") this.activateWorklet(generation);
      });

      this.timer = setInterval(() => {
        if (
          this.lifecycleGeneration !== generation ||
          !this.analyser ||
          !this.audioContext
        )
          return;

        // Auto-resume: Chrome suspends AudioContexts created before user
        // gesture. Try to resume every tick until it succeeds. Once the
        // user has interacted with the page, resume() will work.
        if (!this.contextResumed && context.state === "suspended") {
          context
            .resume()
            .then(() => {
              if (
                this.lifecycleGeneration !== generation ||
                this.audioContext !== context
              )
                return;
              this.contextResumed = true;
              if (DEBUG) vadLog.info("AudioContext resumed");
            })
            .catch(() => {});
          return; // skip this tick — data is stale while suspended
        }
        if (context.state === "running") {
          this.contextResumed = true;
        }

        let rms: number;
        if (typeof this.analyser.getFloatTimeDomainData === "function") {
          this.analyser.getFloatTimeDomainData(dataArray);
          rms = calculateTimeDomainRms(dataArray);
        } else {
          const byteData = new Uint8Array(dataArray.length);
          this.analyser.getByteTimeDomainData(byteData);
          rms = calculateTimeDomainRms(byteData);
        }
        this.lastRms = rms;

        for (const event of core.update(rms, Date.now())) {
          this.handleVadEvent(event);
        }
        // Silence while not speaking: keep the gate applied (idempotent).
        if (
          rms < this.threshold &&
          !this.microphoneSpeaking &&
          this.gateEnabled &&
          this.contextResumed
        ) {
          this.applyGate(true);
        }
      }, 50);

      void this.loadWorklet(context, generation);

      if (DEBUG) vadLog.info("Started voice activity detection");
      return true;
    } catch (err) {
      this.stop();
      vadLog.error("Failed to start:", err);
      return false;
    }
  }

  private async loadWorklet(
    context: AudioContext,
    generation: number,
  ): Promise<void> {
    if (!canUseAudioWorklet(context)) return;
    try {
      await context.audioWorklet.addModule(vadWorkletUrl());
    } catch (err) {
      vadLog.warn("VAD worklet unavailable; using the analyser timer", err);
      return;
    }
    if (
      this.lifecycleGeneration !== generation ||
      this.audioContext !== context
    )
      return;
    this.workletModuleReady = context;
    if (context.state === "running") this.activateWorklet(generation);
  }

  /** Move detection onto the audio thread once the context is running. */
  private activateWorklet(generation: number): void {
    const context = this.audioContext;
    if (
      this.workletNode ||
      !context ||
      this.workletModuleReady !== context ||
      this.lifecycleGeneration !== generation ||
      context.state !== "running" ||
      !this.source ||
      !this.silentOutput
    )
      return;

    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(context, "rm-vad", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          threshold: this.threshold,
          silenceDelayMs: this.silenceDelay,
          speaking: this.microphoneSpeaking,
        },
      });
    } catch (err) {
      vadLog.warn("VAD worklet node failed; using the analyser timer", err);
      return;
    }
    node.port.onmessage = (event: MessageEvent) => {
      if (this.lifecycleGeneration !== generation || this.workletNode !== node)
        return;
      const data = event.data as VadEvent & { rms?: number };
      if (typeof data.rms === "number") this.lastRms = data.rms;
      this.handleVadEvent(data);
    };
    this.source.connect(node);
    node.connect(this.silentOutput);
    this.workletNode = node;
    this.contextResumed = true;

    // The analyser and its 50 ms timer are no longer needed.
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.analyser) {
      try {
        this.source.disconnect(this.analyser);
      } catch {
        /* already disconnected */
      }
      this.analyser.disconnect();
    }
    if (this.gateEnabled && !this.microphoneSpeaking) this.applyGate(true);
    if (DEBUG) vadLog.info("Voice activity detection moved to AudioWorklet");
  }

  /** Apply one transition from the hysteresis (either path). */
  private handleVadEvent(event: VadEvent): void {
    if (event.type === "stalled") {
      if (this.isStalled === event.value) return;
      this.isStalled = event.value;
      this.callbacks.onAudioStalled?.(event.value);
      if (DEBUG) {
        if (event.value)
          vadLog.warn("Audio hardware stalled: 0 RMS straight for 5s");
        else vadLog.info("Audio hardware recovered: Non-zero RMS detected");
      }
      return;
    }
    if (event.value) {
      // Speaking
      if (this.microphoneSpeaking) return;
      this.microphoneSpeaking = true;
      if (this.gateEnabled) this.applyGate(false);
      this.refreshSpeakingState();
      return;
    }
    // Stopped speaking after the silence delay
    if (!this.microphoneSpeaking) return;
    this.microphoneSpeaking = false;
    if (this.gateEnabled) this.applyGate(true);
    this.refreshSpeakingState();
  }

  /** Whether detection currently runs on the audio thread (diagnostics). */
  isUsingAudioWorklet(): boolean {
    return this.workletNode !== null;
  }

  /** Reconcile speaking signaling after a participant ID becomes available. */
  refreshSpeakingState(force = false): void {
    const flags =
      (this.microphoneSpeaking
        ? SpeakingFlags.MICROPHONE
        : SpeakingFlags.NONE) |
      (this.soundboardSpeaking ? SpeakingFlags.SOUNDSHARE : SpeakingFlags.NONE);
    const nextIsSpeaking = flags !== SpeakingFlags.NONE;
    const speakingChanged = this.isSpeaking !== nextIsSpeaking;
    this.isSpeaking = nextIsSpeaking;

    const participantId = this.callbacks.getParticipantId();
    if (!participantId) {
      this.lastSentParticipantId = null;
      this.lastEmittedParticipantId = null;
      return;
    }

    const signalingChanged =
      force ||
      this.lastSentParticipantId !== participantId ||
      this.lastSentFlags !== flags;
    if (
      signalingChanged &&
      (flags !== SpeakingFlags.NONE ||
        this.lastSentFlags !== SpeakingFlags.NONE)
    ) {
      this.lastSentFlags = flags;
      this.callbacks.sendSpeaking(flags);
    }
    this.lastSentParticipantId = participantId;

    const participantChanged = this.lastEmittedParticipantId !== participantId;
    if (
      (speakingChanged || participantChanged) &&
      (speakingChanged || nextIsSpeaking)
    ) {
      this.callbacks.onSpeakingChange(nextIsSpeaking, flags);
    }
    this.lastEmittedParticipantId = participantId;
  }

  /** Update activity contributed by local soundboard playback. */
  setSoundboardSpeaking(isSpeaking: boolean): void {
    this.soundboardSpeaking = isSpeaking;
    this.refreshSpeakingState();
  }

  /**
   * Called by SFUClient when the push audio transceiver becomes ready
   * (after NegotiationDone). For long-lived Cloudflare Realtime tracks we keep
   * the RTP sender active even during silence, because the SFU garbage-collects
   * tracks after a period with no received media packets.
   */
  onTransceiverReady(): void {
    // Only gate immediately if the VAD AudioContext is running — otherwise
    // we can't detect speech and the gate would stay ON permanently on
    // Firefox autoJoin (suspended context, no user gesture).
    if (
      this.gateEnabled &&
      (!this.microphoneEnabled || !this.microphoneSpeaking) &&
      this.contextResumed
    ) {
      if (DEBUG) vadLog.info("Transceiver ready — applying initial gate");
      this.applyGate(true);
    }
  }

  /**
   * Stop VAD monitoring. Call when mic is turned off or leaving.
   */
  stop(): void {
    this.lifecycleGeneration += 1;
    if (this.gateEnabled) {
      const desiredGated = !this.microphoneEnabled;
      this.applyGate(desiredGated);
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.port.postMessage({ type: "stop" });
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.workletModuleReady = null;
    this.core = null;
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.silentOutput) {
      this.silentOutput.disconnect();
      this.silentOutput = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
    }
    if (this.vadTrack) {
      this.vadTrack.stop();
      this.vadTrack = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
    this.contextResumed = false;

    if (this.isStalled) {
      this.isStalled = false;
      this.callbacks.onAudioStalled?.(false);
    }

    this.microphoneSpeaking = false;
    this.refreshSpeakingState();
  }

  /**
   * Update the RMS threshold dynamically.
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
    this.core?.setThreshold(threshold);
    this.workletNode?.port.postMessage({ type: "threshold", value: threshold });
    if (DEBUG) vadLog.info("Threshold updated to:", threshold);
  }

  /**
   * Resume the VAD's AudioContext after a user gesture.
   */
  resumeContext(): void {
    this.gateController?.resume?.();
    const context = this.audioContext;
    const generation = this.lifecycleGeneration;
    if (context && context.state === "suspended") {
      context
        .resume()
        .then(() => {
          if (
            this.lifecycleGeneration !== generation ||
            this.audioContext !== context
          )
            return;
          this.contextResumed = true;
          if (DEBUG) vadLog.info("AudioContext resumed");
        })
        .catch(() => {});
    }
  }

  /**
   * Enable noise gate — when active, audio below the RMS threshold is muted
   * in the source gate so others don't hear background noise.
   *
   * IMPORTANT: We only activate the gate immediately if the VAD AudioContext
   * is confirmed running. On Firefox autoJoin (no user gesture), the context
   * starts suspended → the VAD can't detect speech → the gate would stay ON
   * forever, permanently silencing outgoing RTP. When the context eventually
   * resumes (user gesture), the statechange listener applies the gate.
   */
  enableNoiseGate(): void {
    this.gateEnabled = true;
    if (!this.microphoneEnabled) {
      this.applyGate(true);
      if (DEBUG) vadLog.info("Noise gate enabled");
      return;
    }
    if (!this.microphoneSpeaking && this.contextResumed) {
      this.applyGate(true);
    }
    if (DEBUG) vadLog.info("Noise gate enabled");
  }

  /**
   * Disable noise gate — all source audio passes through regardless of RMS state.
   */
  disableNoiseGate(): void {
    this.gateEnabled = false;
    this.applyGate(false);
    if (DEBUG) vadLog.info("Noise gate disabled");
  }

  /** Reapply the current gate to a newly replaced published source. */
  reapplyGate(): void {
    if (this.gateEnabled) this.applyGate(this.getDesiredGateState());
  }

  /** Keep source PCM gating consistent with the user's microphone mute. */
  setMicrophoneEnabled(enabled: boolean): void {
    this.microphoneEnabled = enabled;
    if (!enabled) {
      this.microphoneSpeaking = false;
      // Let the hysteresis re-detect from silence, like the timer path did.
      this.core?.resetSpeaking();
      this.workletNode?.port.postMessage({ type: "reset-speaking" });
    }
    if (this.gateEnabled) this.applyGate(this.getDesiredGateState());
  }

  private getDesiredGateState(): boolean {
    if (!this.microphoneEnabled) return true;
    if (!this.contextResumed) return false;
    return this.isGated;
  }

  private applyGate(gated: boolean): void {
    if (this.isGated === gated) return;
    this.isGated = gated;
    this.gateController?.setGated(gated);
    if (DEBUG)
      vadLog.info(
        `Audio gate ${gated ? "ON ■ (silence)" : "OFF ▶ (speaking)"}`,
      );
  }

  /**
   * Most recent RMS level (0-100 scale). On the worklet path it is the level
   * at the last transition, since per-tick levels never leave the audio
   * thread.
   */
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
