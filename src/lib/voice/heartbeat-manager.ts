import { clog, ScopedLogger } from "@/lib/console-logger";
// ============================================================================
// HeartbeatManager — Reusable timer for WebSocket heartbeat lifecycle
//
// One instance per WebSocket, owned by its RealtimeSocket lifecycle
// (src/lib/realtime-socket). Handles:
//   - Periodic heartbeat sends at configurable intervals
//   - Missed-beat tracking with zombie detection
//   - Clean start/stop lifecycle
// ============================================================================

/** Callbacks from HeartbeatManager to the socket that owns it */
export interface HeartbeatCallbacks {
  /** Send a heartbeat beat (payload construction is caller's responsibility) */
  sendBeat(): void;
  /** Called when too many heartbeats are missed (zombie connection) */
  onZombie(): void;
}

/** Runs `callback` once after `ms`; returns a function that cancels it. */
export type ScheduleTimer = (callback: () => void, ms: number) => () => void;

const scheduleWithGlobalTimers: ScheduleTimer = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

export class HeartbeatManager {
  private cancelBeat: (() => void) | null = null;
  private lastAckReceived: boolean = true;
  private missedBeats: number = 0;

  private readonly label: string;
  private readonly maxMissed: number;
  private readonly callbacks: HeartbeatCallbacks;
  private readonly schedule: ScheduleTimer;
  private log: ScopedLogger;

  /**
   * @param label - A label for logging (e.g. "ChatGW", "VoiceGW")
   * @param callbacks - Send beat and zombie handlers
   * @param maxMissed - Max consecutive missed beats before zombie (default 3)
   * @param schedule - Timer source (the lifecycle's clock in tests)
   */
  constructor(
    label: string,
    callbacks: HeartbeatCallbacks,
    maxMissed = 3,
    schedule: ScheduleTimer = scheduleWithGlobalTimers,
  ) {
    this.label = label;
    this.log = clog(label);
    this.callbacks = callbacks;
    this.maxMissed = maxMissed;
    this.schedule = schedule;
  }

  /**
   * Start the heartbeat timer. Call this when the Hello message is received
   * with the server-specified heartbeat interval.
   */
  start(interval: number): void {
    this.stop();
    this.lastAckReceived = true;
    this.missedBeats = 0;

    const beat = () => {
      this.cancelBeat = null;
      if (!this.lastAckReceived) {
        this.missedBeats++;
        this.log.warn(
          `Heartbeat not ACK'd (missed ${this.missedBeats}/${this.maxMissed})`,
        );
        if (this.missedBeats >= this.maxMissed) {
          this.log.error(`Zombie connection detected — triggering reconnect`);
          this.callbacks.onZombie();
          return;
        }
      }
      this.lastAckReceived = false;
      this.cancelBeat = this.schedule(beat, interval);
      this.callbacks.sendBeat();
    };
    this.cancelBeat = this.schedule(beat, interval);

    this.log.info(`Heartbeat started (interval: ${interval}ms)`);
  }

  /** Process a HeartbeatACK from the server */
  onAck(): void {
    this.lastAckReceived = true;
    this.missedBeats = 0;
  }

  /** Stop the heartbeat timer */
  stop(): void {
    this.cancelBeat?.();
    this.cancelBeat = null;
  }

  /** Dispose resources */
  dispose(): void {
    this.stop();
  }
}
