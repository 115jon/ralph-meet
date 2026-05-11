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

  constructor(private options: AudioSentinelOptions) { }

  public start() {
    if (this.timer) return;
    this.prevBytesReceived = null;
    this.consecutiveZeroDeltas = 0;
    this.isStalled = false;

    const interval = this.options.intervalMs ?? 1000;
    const threshold = this.options.stallThresholdTicks ?? 5;

    log.info(`AudioSentinel started (interval: ${interval}ms, threshold: ${threshold} ticks)`);

    this.timer = setInterval(async () => {
      const pc = this.options.pc();
      if (!pc || pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") {
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
            currentBytes += (report.bytesReceived || 0);
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
              if (this.options.shouldTreatAsStall && !this.options.shouldTreatAsStall()) {
                this.consecutiveZeroDeltas = Math.max(0, threshold - 1);
                return;
              }
              this.isStalled = true;
              log.error(`Audio stall detected: no inbound bytes for ${this.consecutiveZeroDeltas} ticks. (Bytes: ${currentBytes}, PacketsLost: ${lastPacketsLost}, Jitter: ${lastJitter})`);
              this.options.onStall();
            } else if (!this.isStalled) {
              // Log minor stalls for deep debugging
              log.debug(`Warning: Audio bytes stalled for ${this.consecutiveZeroDeltas} ticks...`);
            }
          } else {
            // Audio is flowing
            if (this.isStalled) {
              log.info(`Audio recovered after ${this.consecutiveZeroDeltas} stalled ticks.`);
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
