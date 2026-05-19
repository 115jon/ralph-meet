import { clog } from "@/lib/console-logger";

const audioLog = clog("SFU:Audio");
// ============================================================================
// AudioPipeline — Volume control, master gain, limiter, output device
//
// Chain: MediaStreamSource → per-participant GainNode → Limiter → MasterGain → destination
// ============================================================================

import { resumeSoundContext } from "@/lib/sounds";

// ── Audio Context Prewarming ──────────────────────────────────────────────
// Chrome requires AudioContext.resume() to be called during a user gesture.
// For calls, the SFU connects asynchronously after a gateway event (outside
// any gesture). prewarmAudioContext() should be called from the Accept/Call
// button click handler so the context is created in "running" state.
let _prewarmedContext: AudioContext | null = null;

/**
 * Create and resume an AudioContext during a user gesture (click/tap).
 * The AudioPipeline will reuse this context instead of creating a new
 * suspended one. Call this from call Accept/Initiate button handlers.
 *
 * Also resumes the sound effects AudioContext so a single user gesture
 * unlocks ALL audio — preventing the double "Interaction Required" modal.
 */
export function prewarmAudioContext(): void {
  try {
    if (!_prewarmedContext || _prewarmedContext.state === 'closed') {
      _prewarmedContext = new AudioContext();
    }
    _prewarmedContext.resume().catch(() => { });
    // Unify: also resume the sound effects context during this gesture
    resumeSoundContext().catch(() => { });
  } catch { /* AudioContext unavailable */ }
}

/** Callback to notify SFUClient of audio context state changes */
export interface AudioPipelineCallbacks {
  onAudioResumed(): void;
}

export class AudioPipeline {
  private volumeContext: AudioContext | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterGainNode: GainNode | null = null;
  private volumeLevels: Map<string, number> = new Map();
  private volumeGains: Map<string, Map<string, GainNode>> = new Map();
  private volumeSources: Map<string, Map<string, MediaStreamAudioSourceNode>> = new Map();
  /** Muted <audio> elements that activate Chrome's remote track media pipeline */
  private activatorElements: Map<string, Map<string, HTMLAudioElement>> = new Map();
  /**
   * Tracks that were connected while the AudioContext was suspended.
   * Firefox silently drops audio from createMediaStreamSource() on a suspended
   * context (no buffering). When the context transitions to 'running' via user
   * gesture, we re-create the MediaStreamSource for each pending track.
   */
  private pendingTracks: Map<string, { participantId: string; trackName: string; stream: MediaStream }> = new Map();
  /** Whether we've already installed the onstatechange listener */
  private stateChangeInstalled = false;

  private readonly callbacks: AudioPipelineCallbacks;

  constructor(callbacks: AudioPipelineCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Resume the volume AudioContext if it's suspended.
   * Call this from a user gesture (like clicking "Join").
   */
  async resumeAudioContext(): Promise<void> {
    if (!this.volumeContext) {
      // Reuse a prewarmed context from a user gesture (call accept/initiate)
      if (_prewarmedContext && _prewarmedContext.state !== 'closed') {
        this.volumeContext = _prewarmedContext;
        _prewarmedContext = null;
      } else {
        this.volumeContext = new AudioContext();
      }
    }
    if (this.volumeContext.state === 'suspended') {
      try {
        await this.volumeContext.resume();
        audioLog.info("AudioContext resumed successfully");
        this.callbacks.onAudioResumed();
      } catch (err) {
        audioLog.warn("Failed to resume AudioContext:", err);
      }
    }
    // Also resume the sound effects context so both are unlocked together
    resumeSoundContext().catch(() => { });
  }

  /**
   * Check if the AudioContext is currently suspended (blocked by browser).
   */
  isAudioSuspended(): boolean {
    return this.volumeContext?.state === 'suspended';
  }

  /**
   * Set the volume for a specific remote participant (0.0 = mute, 1.0 = normal, max 2.0).
   * Clamped to prevent extreme amplification — the limiter catches any remaining peaks.
   */
  setParticipantVolume(participantId: string, level: number): void {
    this.resumeAudioContext().catch(() => { });
    const clamped = Math.max(0, Math.min(level, 2.0));
    this.volumeLevels.set(participantId, clamped);
    const gains = this.volumeGains.get(participantId);
    if (gains) {
      gains.forEach((gn) => {
        gn.gain.setTargetAtTime(clamped, this.volumeContext?.currentTime || 0, 0.1);
      });
    }
  }

  /**
   * Sets volume for a specific track of a participant (clamped to 0.0–2.0).
   */
  setTrackVolume(participantId: string, trackName: string, level: number): void {
    this.resumeAudioContext().catch(() => { });
    const clamped = Math.max(0, Math.min(level, 2.0));
    const gains = this.volumeGains.get(participantId);
    const gn = gains?.get(trackName);
    if (gn) {
      gn.gain.setTargetAtTime(clamped, this.volumeContext?.currentTime || 0, 0.1);
    }
  }

  /** Get current volume level for a participant (defaults to 1.0). */
  getParticipantVolume(participantId: string): number {
    return this.volumeLevels.get(participantId) ?? 1.0;
  }

  /**
   * Applies AudioContext-based volume/gain control to an incoming track.
   * Chain: Source → GainNode → Limiter → MasterGain → destination
   * The limiter prevents clipping when multiple participants sum.
   */
  applyVolumeToTrack(participantId: string, track: MediaStreamTrack, trackName: string): MediaStream {
    if (track.kind !== "audio") {
      return new MediaStream([track]);
    }

    if (!this.volumeContext) {
      // Reuse prewarmed context if available
      if (_prewarmedContext && _prewarmedContext.state !== 'closed') {
        this.volumeContext = _prewarmedContext;
        _prewarmedContext = null;
      } else {
        this.volumeContext = new AudioContext();
      }
    }

    const ctx = this.volumeContext;
    ctx.resume().catch(() => { });

    // Create or reuse the shared limiter (one per AudioContext).
    // This is a DynamicsCompressorNode configured as a brick-wall limiter:
    // high threshold + hard knee + extreme ratio = only catches near-clipping
    // peaks, preserving natural dynamics (quiet audio stays quiet).
    if (!this.limiter) {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3;    // only engage at -3 dBFS (near clipping)
      lim.knee.value = 0;          // hard knee — brick-wall behavior
      lim.ratio.value = 20;        // near-infinite compression above threshold
      lim.attack.value = 0.001;    // 1 ms — catch transients instantly
      lim.release.value = 0.1;     // 100 ms — recover fast, don't color the sound

      // Insert master gain between limiter and destination
      if (!this.masterGainNode) {
        this.masterGainNode = ctx.createGain();
        this.masterGainNode.connect(ctx.destination);
      }
      lim.connect(this.masterGainNode);
      this.limiter = lim;
    }

    // ── Chrome audio track activator ─────────────────────────────────
    // Chrome won't decode/activate a remote WebRTC track's media pipeline
    // until the track is attached to a media element (<audio> or <video>).
    // createMediaStreamSource() alone doesn't count as a consumer — it
    // reads zeros from the un-activated track. In voice channels the
    // ParticipantCard's <VideoPlayer> element serves as the activator,
    // but in calls (and any context without a visible media element for
    // audio tracks) we need an explicit one. The element is muted so all
    // audible output goes through the Web Audio pipeline (ctx.destination).
    const activatorStream = new MediaStream([track]);
    const activator = document.createElement('audio');
    activator.srcObject = activatorStream;
    activator.volume = 0;       // silent — Web Audio handles audible output
    activator.muted = true;     // also mute attribute for extra safety
    activator.autoplay = true;
    activator.play().catch(() => { });

    // Store activator for cleanup
    let participantActivators = this.activatorElements.get(participantId);
    if (!participantActivators) {
      participantActivators = new Map();
      this.activatorElements.set(participantId, participantActivators);
    }
    const existingActivator = participantActivators.get(trackName);
    if (existingActivator) {
      existingActivator.srcObject = null;
    }
    participantActivators.set(trackName, activator);

    const source = ctx.createMediaStreamSource(activatorStream);
    const gainNode = ctx.createGain();

    const level = this.volumeLevels.get(participantId) ?? 1.0;
    gainNode.gain.value = Math.max(0, Math.min(level, 2.0));
    source.connect(gainNode);
    gainNode.connect(this.limiter);

    let participantGains = this.volumeGains.get(participantId);
    if (!participantGains) {
      participantGains = new Map();
      this.volumeGains.set(participantId, participantGains);
    }
    const existingGain = participantGains.get(trackName);
    if (existingGain) {
      existingGain.disconnect();
    }
    participantGains.set(trackName, gainNode);

    let participantSources = this.volumeSources.get(participantId);
    if (!participantSources) {
      participantSources = new Map();
      this.volumeSources.set(participantId, participantSources);
    }
    const existingSource = participantSources.get(trackName);
    if (existingSource) {
      existingSource.disconnect();
    }
    participantSources.set(trackName, source);

    // ── Firefox suspended-context fix ─────────────────────────────────
    // Firefox silently drops audio from createMediaStreamSource() when the
    // AudioContext is suspended (no buffering, no error — just silence).
    // This happens on auto-join flows where handleJoin() runs from a useEffect
    // with no user gesture, so ctx.resume() doesn't take effect.
    //
    // Solution: if the context is still suspended after our resume() attempt,
    // record this track as "pending". When the context eventually transitions
    // to 'running' (triggered by a user click/keypress via the resume listener
    // in useRoomVoiceChannel), we re-create the MediaStreamSource so audio
    // actually flows through the graph.
    if (ctx.state === 'suspended') {
      const key = `${participantId}::${trackName}`;
      this.pendingTracks.set(key, { participantId, trackName, stream: activatorStream });
      audioLog.warn(`AudioContext suspended — deferring audio connection for ${trackName} (will reconnect on resume)`);
      this.installContextStateListener();
    }

    // Return the original stream; the AudioContext handles the audible output.
    return new MediaStream([track]);
  }

  /**
   * Install an onstatechange listener on the AudioContext that re-connects
   * any pending audio sources when the context transitions to 'running'.
   * This is the Firefox fix: audio connected during suspension is silently dropped,
   * so we must re-create the MediaStreamSource once the context is live.
   */
  private installContextStateListener(): void {
    if (this.stateChangeInstalled || !this.volumeContext) return;
    this.stateChangeInstalled = true;

    this.volumeContext.onstatechange = () => {
      const ctx = this.volumeContext;
      if (!ctx || ctx.state !== 'running' || this.pendingTracks.size === 0) return;

      audioLog.info(`AudioContext now running — reconnecting ${this.pendingTracks.size} deferred audio track(s)`);

      for (const [key, { participantId, trackName, stream }] of this.pendingTracks) {
        // Verify the track is still alive (participant may have left)
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState !== 'live') {
          audioLog.info(`Skipping dead deferred track: ${trackName}`);
          continue;
        }

        try {
          // Disconnect the old (silent) source
          const oldSources = this.volumeSources.get(participantId);
          const oldSource = oldSources?.get(trackName);
          if (oldSource) {
            oldSource.disconnect();
          }

          // Re-create the source now that the context is running
          const newSource = ctx.createMediaStreamSource(stream);
          const gains = this.volumeGains.get(participantId);
          const gainNode = gains?.get(trackName);
          if (gainNode) {
            newSource.connect(gainNode);
          } else if (this.limiter) {
            // Fallback: connect directly to limiter
            newSource.connect(this.limiter);
          }

          // Update the source reference
          if (oldSources) {
            oldSources.set(trackName, newSource);
          }

          // Also re-trigger the activator play() now that we have a gesture
          const activators = this.activatorElements.get(participantId);
          const activator = activators?.get(trackName);
          if (activator) {
            activator.play().catch(() => { });
          }

          audioLog.info(`Reconnected deferred audio: ${trackName}`);
        } catch (err) {
          audioLog.warn(`Failed to reconnect deferred track ${trackName}:`, err);
        }
      }

      this.pendingTracks.clear();
    };
  }

  /** Clean up volume processing nodes for a participant. */
  removeParticipantVolume(participantId: string): void {
    const sources = this.volumeSources.get(participantId);
    if (sources) {
      sources.forEach(s => s.disconnect());
      this.volumeSources.delete(participantId);
    }
    const gains = this.volumeGains.get(participantId);
    if (gains) {
      gains.forEach(g => g.disconnect());
      this.volumeGains.delete(participantId);
    }
    const activators = this.activatorElements.get(participantId);
    if (activators) {
      activators.forEach(a => { a.srcObject = null; });
      this.activatorElements.delete(participantId);
    }
  }

  /** Clean up volume processing nodes for a single track of a participant. */
  removeTrackVolume(participantId: string, trackName: string): void {
    const sources = this.volumeSources.get(participantId);
    if (sources) {
      const source = sources.get(trackName);
      if (source) {
        source.disconnect();
        sources.delete(trackName);
      }
    }
    const gains = this.volumeGains.get(participantId);
    if (gains) {
      const gain = gains.get(trackName);
      if (gain) {
        gain.disconnect();
        gains.delete(trackName);
      }
    }
    const activators = this.activatorElements.get(participantId);
    if (activators) {
      const activator = activators.get(trackName);
      if (activator) {
        activator.srcObject = null;
        activators.delete(trackName);
      }
    }
  }

  /**
   * Set the master output volume (0.0 = silent, 1.0 = normal, 2.0 = max boost).
   * Maps from the UI's 0–200% slider via `level = slider / 100`.
   */
  setMasterVolume(level: number): void {
    const clamped = Math.max(0, Math.min(level, 2.0));
    if (!this.volumeContext) {
      if (_prewarmedContext && _prewarmedContext.state !== 'closed') {
        this.volumeContext = _prewarmedContext;
        _prewarmedContext = null;
      } else {
        this.volumeContext = new AudioContext();
      }
    }
    const ctx = this.volumeContext;
    if (!this.masterGainNode) {
      this.masterGainNode = ctx.createGain();
      this.masterGainNode.connect(ctx.destination);
      // Re-connect limiter through master gain if it exists
      if (this.limiter) {
        this.limiter.disconnect();
        this.limiter.connect(this.masterGainNode);
      }
    }
    this.masterGainNode.gain.setTargetAtTime(clamped, ctx.currentTime || 0, 0.05);
  }

  /**
   * Set the output audio device. Uses AudioContext.setSinkId() where supported.
   * Falls back silently on browsers that don't support it.
   */
  async setOutputDevice(deviceId: string): Promise<void> {
    if (!this.volumeContext) {
      // Reuse prewarmed context (created during Accept/Call user gesture)
      if (_prewarmedContext && _prewarmedContext.state !== 'closed') {
        this.volumeContext = _prewarmedContext;
        _prewarmedContext = null;
      } else {
        this.volumeContext = new AudioContext();
      }
    }

    // Ensure context is running (may still be suspended if created outside
    // a user gesture and the prewarmed context wasn't available)
    this.volumeContext.resume().catch(() => { });

    const ctx = this.volumeContext as any;
    if (typeof ctx.setSinkId === 'function') {
      try {
        const sinkId = deviceId === 'default' || deviceId.startsWith('native:') ? '' : deviceId;
        await ctx.setSinkId(sinkId);
        audioLog.info(`Output device set to: ${deviceId}`);
      } catch (err) {
        audioLog.warn("Failed to set output device:", err);
      }
    } else {
      audioLog.warn("setSinkId not supported in this browser");
    }
  }

  /**
   * Routes a local microphone track through the AudioContext without connecting it to the
   * audible destination. This creates a "clean" MediaStream track that loses the internal
   * "getUserMedia" tag, bypassing aggressive browser APM (Acoustic Processing) for high-fidelity audio.
   */
  createTrueStereoStream(track: MediaStreamTrack): MediaStream {
    if (track.kind !== "audio") {
      return new MediaStream([track]);
    }

    if (!this.volumeContext) {
      if (_prewarmedContext && _prewarmedContext.state !== 'closed') {
        this.volumeContext = _prewarmedContext;
        _prewarmedContext = null;
      } else {
        this.volumeContext = new AudioContext();
      }
    }
    const ctx = this.volumeContext;
    ctx.resume().catch(() => { });

    const sourceStream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(sourceStream);
    const destination = ctx.createMediaStreamDestination();

    // Connect directly to the destination node (which produces a MediaStream, NOT the speakers)
    source.connect(destination);

    return destination.stream;
  }

  /** Dispose all audio resources. */
  dispose(): void {
    this.volumeGains.forEach(gains => gains.forEach(g => g.disconnect()));
    this.volumeGains.clear();
    this.volumeSources.forEach(sources => sources.forEach(s => s.disconnect()));
    this.volumeSources.clear();
    this.volumeLevels.clear();
    this.activatorElements.forEach(acts => acts.forEach(a => { a.srcObject = null; }));
    this.activatorElements.clear();
    this.pendingTracks.clear();
    this.stateChangeInstalled = false;
    if (this.limiter) {
      this.limiter.disconnect();
      this.limiter = null;
    }
    if (this.masterGainNode) {
      this.masterGainNode.disconnect();
      this.masterGainNode = null;
    }
    if (this.volumeContext) {
      this.volumeContext.onstatechange = null;
      this.volumeContext.close().catch(() => { });
      this.volumeContext = null;
    }
  }
}
