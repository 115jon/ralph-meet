// ============================================================================
// AudioPipeline — Volume control, master gain, compressor, output device
//
// Chain: MediaStreamSource → per-participant GainNode → DynamicsCompressor → MasterGain → destination
// ============================================================================

/** Callback to notify SFUClient of audio context state changes */
export interface AudioPipelineCallbacks {
  onAudioResumed(): void;
}

export class AudioPipeline {
  private volumeContext: AudioContext | null = null;
  private volumeCompressor: DynamicsCompressorNode | null = null;
  private masterGainNode: GainNode | null = null;
  private volumeLevels: Map<string, number> = new Map();
  private volumeGains: Map<string, Map<string, GainNode>> = new Map();
  private volumeSources: Map<string, Map<string, MediaStreamAudioSourceNode>> = new Map();

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
      this.volumeContext = new AudioContext();
    }
    if (this.volumeContext.state === 'suspended') {
      try {
        await this.volumeContext.resume();
        console.log("[SFU:Audio] AudioContext resumed successfully");
        this.callbacks.onAudioResumed();
      } catch (err) {
        console.warn("[SFU:Audio] Failed to resume AudioContext:", err);
      }
    }
  }

  /**
   * Check if the AudioContext is currently suspended (blocked by browser).
   */
  isAudioSuspended(): boolean {
    return this.volumeContext?.state === 'suspended';
  }

  /**
   * Set the volume for a specific remote participant (0.0 = mute, 1.0 = normal, max 2.0).
   * Clamped to prevent extreme amplification — the DynamicsCompressor handles the rest.
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
   * Chain: Source → GainNode → DynamicsCompressorNode → destination
   * The compressor prevents clipping when multiple participants sum.
   */
  applyVolumeToTrack(participantId: string, track: MediaStreamTrack, trackName: string): MediaStream {
    if (track.kind !== "audio") {
      return new MediaStream([track]);
    }

    if (!this.volumeContext) {
      this.volumeContext = new AudioContext();
    }

    const ctx = this.volumeContext;
    ctx.resume().catch(() => { });

    // Create or reuse the shared compressor (one per AudioContext)
    if (!this.volumeCompressor) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;  // start compressing at -24 dBFS
      comp.knee.value = 30;        // soft knee for natural sound
      comp.ratio.value = 12;       // aggressive ratio to prevent clipping
      comp.attack.value = 0.003;   // fast attack to catch transients
      comp.release.value = 0.25;   // moderate release for smooth recovery

      // Insert master gain between compressor and destination
      if (!this.masterGainNode) {
        this.masterGainNode = ctx.createGain();
        this.masterGainNode.connect(ctx.destination);
      }
      comp.connect(this.masterGainNode);
      this.volumeCompressor = comp;
    }

    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const gainNode = ctx.createGain();

    const level = this.volumeLevels.get(participantId) ?? 1.0;
    gainNode.gain.value = Math.max(0, Math.min(level, 2.0));
    source.connect(gainNode);
    gainNode.connect(this.volumeCompressor);

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

    // Return the original stream; the AudioContext handles the audible output.
    return new MediaStream([track]);
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
  }

  /**
   * Set the master output volume (0.0 = silent, 1.0 = normal, 2.0 = max boost).
   * Maps from the UI's 0–200% slider via `level = slider / 100`.
   */
  setMasterVolume(level: number): void {
    const clamped = Math.max(0, Math.min(level, 2.0));
    if (!this.volumeContext) {
      this.volumeContext = new AudioContext();
    }
    const ctx = this.volumeContext;
    if (!this.masterGainNode) {
      this.masterGainNode = ctx.createGain();
      this.masterGainNode.connect(ctx.destination);
      // Re-connect compressor through master gain if it exists
      if (this.volumeCompressor) {
        this.volumeCompressor.disconnect();
        this.volumeCompressor.connect(this.masterGainNode);
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
      this.volumeContext = new AudioContext();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = this.volumeContext as any;
    if (typeof ctx.setSinkId === 'function') {
      try {
        await ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
        console.log(`[SFU:Audio] Output device set to: ${deviceId}`);
      } catch (err) {
        console.warn('[SFU:Audio] Failed to set output device:', err);
      }
    } else {
      console.warn('[SFU:Audio] setSinkId not supported in this browser');
    }
  }

  /** Dispose all audio resources. */
  dispose(): void {
    this.volumeGains.forEach(gains => gains.forEach(g => g.disconnect()));
    this.volumeGains.clear();
    this.volumeSources.forEach(sources => sources.forEach(s => s.disconnect()));
    this.volumeSources.clear();
    this.volumeLevels.clear();
    if (this.volumeCompressor) {
      this.volumeCompressor.disconnect();
      this.volumeCompressor = null;
    }
    if (this.masterGainNode) {
      this.masterGainNode.disconnect();
      this.masterGainNode = null;
    }
    if (this.volumeContext) {
      this.volumeContext.close().catch(() => { });
      this.volumeContext = null;
    }
  }
}
