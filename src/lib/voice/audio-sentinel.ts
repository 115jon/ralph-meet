import { clog } from "../console-logger";

const log = clog("AudioSentinel");

export interface AudioSentinelOptions {
  /** The RTCPeerConnection to monitor (should be the pull PC) */
  pc: () => RTCPeerConnection | null;
  /** Callback fired when bytesReceived stays identical for the threshold duration */
  onStall: () => void;
  /** Callback fired when bytesReceived starts increasing again after a stall */
  onRecover: () => void;
  /** Return false when stalled bytes are expected, for example remote silence/DTX */
  shouldTreatAsStall?: () => boolean;
  /** Polling interval (default 1000ms) */
  intervalMs?: number;
  /** How many consecutive polling ticks with 0 delta before triggering a stall (default 5) */
  stallThresholdTicks?: number;
}

export class AudioSentinel {
  private timer: ReturnType<typeof setInterval> | null = null;
  private prevBytesReceived: number | null = null;
  private consecutiveZeroDeltas = 0;
  private isStalled = false;

  constructor(private options: AudioSentinelOptions) {}

  public start() {
    if (this.timer) return;
    this.prevBytesReceived = null;
    this.consecutiveZeroDeltas = 0;
    this.isStalled = false;

    const interval = this.options.intervalMs ?? 1000;
    const threshold = this.options.stallThresholdTicks ?? 5;

    log.info(
      `AudioSentinel started (interval: ${interval}ms, threshold: ${threshold} ticks)`,
    );

    this.timer = setInterval(async () => {
      const pc = this.options.pc();
      if (
        !pc ||
        (pc.iceConnectionState !== "connected" &&
          pc.iceConnectionState !== "completed")
      ) {
        // Only monitor when ICE is actively connected. If ICE is disconnected/checking,
        // it's a known network routing issue, not a "ghost drop" of the audio packets.
        this.prevBytesReceived = null;
        this.consecutiveZeroDeltas = 0;
        return;
      }

      try {
        const stats = await pc.getStats();
        let currentBytes = 0;
        let lastJitter = 0;
        let lastPacketsLost = 0;
        let foundAudio = false;

        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            foundAudio = true;
            currentBytes += report.bytesReceived || 0;
            lastJitter = report.jitter || 0;
            lastPacketsLost = report.packetsLost || 0;
          }
        });

        if (!foundAudio) {
          // No audio track is being pulled yet.
          this.prevBytesReceived = null;
          return;
        }

        if (this.prevBytesReceived !== null) {
          const delta = currentBytes - this.prevBytesReceived;
          if (delta === 0) {
            this.consecutiveZeroDeltas++;
            if (this.consecutiveZeroDeltas >= threshold && !this.isStalled) {
              if (
                this.options.shouldTreatAsStall &&
                !this.options.shouldTreatAsStall()
              ) {
                this.consecutiveZeroDeltas = Math.max(0, threshold - 1);
                return;
              }
              this.isStalled = true;
              log.error(
                `Audio stall detected: no inbound bytes for ${this.consecutiveZeroDeltas} ticks. (Bytes: ${currentBytes}, PacketsLost: ${lastPacketsLost}, Jitter: ${lastJitter})`,
              );
              this.options.onStall();
            } else if (!this.isStalled) {
              // Log minor stalls for deep debugging
              log.debug(
                `Warning: Audio bytes stalled for ${this.consecutiveZeroDeltas} ticks...`,
              );
            }
          } else {
            // Audio is flowing
            if (this.isStalled) {
              log.info(
                `Audio recovered after ${this.consecutiveZeroDeltas} stalled ticks.`,
              );
              this.isStalled = false;
              this.options.onRecover();
            }
            this.consecutiveZeroDeltas = 0;
          }
        }

        this.prevBytesReceived = currentBytes;
      } catch (err) {
        log.warn("Failed to getStats for AudioSentinel:", err);
      }
    }, interval);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.prevBytesReceived = null;
    this.consecutiveZeroDeltas = 0;
    this.isStalled = false;
    log.info("AudioSentinel stopped.");
  }

  public getIsStalled() {
    return this.isStalled;
  }
}

export interface OutboundAudioStallDiagnostics {
  bytesSent: number;
  packetsSent: number;
  trackEnabled: boolean;
  trackReadyState: MediaStreamTrackState;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
}

export interface OutboundAudioSentinelOptions {
  /** The cam push PeerConnection carrying the microphone track. */
  pc: () => RTCPeerConnection | null;
  /** The currently published microphone sender track. */
  track: () => MediaStreamTrack | null;
  /** Callback fired when enabled audio RTP stops increasing. */
  onStall: (diagnostics: OutboundAudioStallDiagnostics) => void;
  /** Callback fired when outbound RTP resumes after a stall. */
  onRecover?: () => void;
  intervalMs?: number;
  stallThresholdTicks?: number;
}

interface OutboundAudioStats {
  type?: string;
  kind?: string;
  mediaType?: string;
  bytesSent?: number;
  packetsSent?: number;
}

/** Detects a live microphone sender that stopped producing outbound RTP. */
export class OutboundAudioSentinel {
  private timer: ReturnType<typeof setInterval> | null = null;
  private previousBytesSent: number | null = null;
  private previousPacketsSent: number | null = null;
  private consecutiveZeroDeltas = 0;
  private isStalled = false;
  private lifecycleGeneration = 0;
  private checkInFlightGeneration: number | null = null;
  private observedPc: RTCPeerConnection | null = null;
  private observedTrack: MediaStreamTrack | null = null;

  constructor(private options: OutboundAudioSentinelOptions) {}

  public start() {
    if (this.timer) return;
    this.lifecycleGeneration++;
    this.reset();

    const interval = this.options.intervalMs ?? 1000;
    const threshold = this.options.stallThresholdTicks ?? 30;
    log.info(
      `OutboundAudioSentinel started (interval: ${interval}ms, threshold: ${threshold} ticks)`,
    );
    this.timer = setInterval(() => void this.check(), interval);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lifecycleGeneration++;
    this.reset();
  }

  public resetMonitoring() {
    this.lifecycleGeneration++;
    this.reset();
  }

  private reset() {
    this.previousBytesSent = null;
    this.previousPacketsSent = null;
    this.consecutiveZeroDeltas = 0;
    this.isStalled = false;
    this.observedPc = null;
    this.observedTrack = null;
  }

  private isConnected(pc: RTCPeerConnection) {
    return (
      pc.connectionState === "connected" &&
      (pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed")
    );
  }

  private async check() {
    const generation = this.lifecycleGeneration;
    if (this.checkInFlightGeneration === generation) return;
    this.checkInFlightGeneration = generation;

    try {
      const pc = this.options.pc();
      const track = this.options.track();
      if (
        !pc ||
        !track ||
        !this.isConnected(pc) ||
        !track.enabled ||
        track.readyState !== "live"
      ) {
        this.reset();
        return;
      }

      if (
        (this.observedPc && this.observedPc !== pc) ||
        (this.observedTrack && this.observedTrack !== track)
      ) {
        this.reset();
      }
      this.observedPc = pc;
      this.observedTrack = track;

      const stats = await pc.getStats();
      if (generation !== this.lifecycleGeneration) {
        return;
      }
      if (this.options.pc() !== pc || this.options.track() !== track) {
        this.reset();
        return;
      }
      if (!track.enabled || track.readyState !== "live") {
        this.reset();
        return;
      }
      let currentBytes = 0;
      let currentPackets = 0;
      let foundAudio = false;
      stats.forEach((rawReport) => {
        const report = rawReport as unknown as OutboundAudioStats;
        const isAudio =
          report.type === "outbound-rtp" &&
          (report.kind === "audio" || report.mediaType === "audio");
        if (!isAudio || typeof report.bytesSent !== "number") return;
        foundAudio = true;
        currentBytes += report.bytesSent;
        currentPackets += report.packetsSent ?? 0;
      });

      if (!foundAudio) {
        this.previousBytesSent = null;
        this.previousPacketsSent = null;
        this.consecutiveZeroDeltas = 0;
        return;
      }

      if (this.previousBytesSent === null) {
        this.previousBytesSent = currentBytes;
        this.previousPacketsSent = currentPackets;
        return;
      }

      const delta = currentBytes - this.previousBytesSent;
      const packetDelta =
        this.previousPacketsSent === null
          ? 0
          : currentPackets - this.previousPacketsSent;
      this.previousBytesSent = currentBytes;
      this.previousPacketsSent = currentPackets;
      if (delta < 0 || packetDelta < 0) {
        this.previousBytesSent = currentBytes;
        this.previousPacketsSent = currentPackets;
        this.consecutiveZeroDeltas = 0;
        return;
      }

      if (delta === 0 && packetDelta === 0) {
        this.consecutiveZeroDeltas++;
        if (
          this.consecutiveZeroDeltas >=
            (this.options.stallThresholdTicks ?? 30) &&
          !this.isStalled
        ) {
          this.isStalled = true;
          const diagnostics: OutboundAudioStallDiagnostics = {
            bytesSent: currentBytes,
            packetsSent: currentPackets,
            trackEnabled: track.enabled,
            trackReadyState: track.readyState,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
          };
          log.error("Outbound audio RTP stall detected", diagnostics);
          this.options.onStall(diagnostics);
        }
        return;
      }

      this.consecutiveZeroDeltas = 0;
      if (this.isStalled) {
        this.isStalled = false;
        log.info("Outbound audio RTP recovered");
        this.options.onRecover?.();
      }
    } catch (error) {
      log.warn("Failed to get outbound audio stats:", error);
    } finally {
      if (this.checkInFlightGeneration === generation) {
        this.checkInFlightGeneration = null;
      }
    }
  }
}
