// ============================================================================
// HeartbeatManager — Reusable timer for WebSocket heartbeat lifecycle
//
// One instance per WebSocket (main + voice). Handles:
//   - Periodic heartbeat sends at configurable intervals
//   - Missed-beat tracking with zombie detection
//   - Clean start/stop lifecycle
// ============================================================================

/** Callbacks from HeartbeatManager to the owning SFUClient */
export interface HeartbeatCallbacks {
  /** Send a heartbeat beat (payload construction is caller's responsibility) */
  sendBeat(): void;
  /** Called when too many heartbeats are missed (zombie connection) */
  onZombie(): void;
}

export class HeartbeatManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAckReceived: boolean = true;
  private missedBeats: number = 0;

  private readonly label: string;
  private readonly maxMissed: number;
  private readonly callbacks: HeartbeatCallbacks;

  /**
   * @param label - A label for logging (e.g. "MainGW", "VoiceGW")
   * @param callbacks - Send beat and zombie handlers
   * @param maxMissed - Max consecutive missed beats before zombie (default 3)
   */
  constructor(label: string, callbacks: HeartbeatCallbacks, maxMissed = 3) {
    this.label = label;
    this.callbacks = callbacks;
    this.maxMissed = maxMissed;
  }

  /**
   * Start the heartbeat timer. Call this when the Hello message is received
   * with the server-specified heartbeat interval.
   */
  start(interval: number): void {
    this.stop();
    this.lastAckReceived = true;
    this.missedBeats = 0;

    this.timer = setInterval(() => {
      if (!this.lastAckReceived) {
        this.missedBeats++;
        console.warn(`[${this.label}] Heartbeat not ACK'd (missed ${this.missedBeats}/${this.maxMissed})`);
        if (this.missedBeats >= this.maxMissed) {
          console.error(`[${this.label}] Zombie connection detected — triggering reconnect`);
          this.stop();
          this.callbacks.onZombie();
          return;
        }
      }
      this.lastAckReceived = false;
      this.callbacks.sendBeat();
    }, interval);

    console.log(`[${this.label}] Heartbeat started (interval: ${interval}ms)`);
  }

  /** Process a HeartbeatACK from the server */
  onAck(): void {
    this.lastAckReceived = true;
    this.missedBeats = 0;
  }

  /** Stop the heartbeat timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Dispose resources */
  dispose(): void {
    this.stop();
  }
}
