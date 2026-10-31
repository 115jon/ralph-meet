// ============================================================================
// StatsHub: one getStats() walk per peer connection, fanned out to consumers
// ============================================================================
//
// Before the hub, a call ran four independent pollers against the same
// PartyTracks peer connection (track stats 2 s, connection stats 2 s with two
// walks, inbound sentinel 1 s, outbound sentinel 1 s): about four full stats
// walks per second. The hub takes one snapshot every `intervalMs` (2 s) and
// hands the same report to every consumer. It drops to `suspectIntervalMs`
// (1 s) only while `isSuspect()` says a stall may be forming, so stall
// detection keeps its resolution when it matters.
//
// The schedule is a setTimeout chain (never overlapping): a slow getStats()
// pushes the next tick back instead of stacking walks.

import { clog } from "../console-logger";

const log = clog("StatsHub");

interface StatsTick {
  /** The single report every consumer reads this tick. */
  report: RTCStatsReport;
  /** The peer connection the report came from. */
  pc: RTCPeerConnection;
  /** Date.now() when the walk resolved. */
  now: number;
  /** Time since the previous delivered tick (0 on the first one). */
  elapsedMs: number;
}

export type StatsConsumer = (tick: StatsTick) => void;

export interface StatsHubOptions {
  pc: () => RTCPeerConnection | null;
  /** Normal cadence. Default 2000 ms. */
  intervalMs?: number;
  /** Cadence while `isSuspect()` is true. Default 1000 ms. */
  suspectIntervalMs?: number;
  /** True while a consumer wants finer resolution (a possible stall). */
  isSuspect?: () => boolean;
}

const STATS_HUB_INTERVAL_MS = 2000;
const STATS_HUB_SUSPECT_INTERVAL_MS = 1000;

export class StatsHub {
  private readonly consumers = new Set<StatsConsumer>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private generation = 0;
  private inFlight: Promise<void> | null = null;
  private lastTickAt: number | null = null;
  private walks = 0;

  constructor(private readonly options: StatsHubOptions) {}

  /** Register a consumer. Returns an unsubscribe function. */
  addConsumer(consumer: StatsConsumer): () => void {
    this.consumers.add(consumer);
    return () => {
      this.consumers.delete(consumer);
    };
  }

  /** Start ticking. The first walk runs immediately. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.lastTickAt = null;
    void this.tick(this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.lastTickAt = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Number of getStats() walks taken since construction (diagnostics/tests). */
  getWalkCount(): number {
    return this.walks;
  }

  /** The delay the hub will use for its next tick. */
  currentIntervalMs(): number {
    const suspect = this.options.isSuspect?.() ?? false;
    return suspect
      ? (this.options.suspectIntervalMs ?? STATS_HUB_SUSPECT_INTERVAL_MS)
      : (this.options.intervalMs ?? STATS_HUB_INTERVAL_MS);
  }

  private schedule(generation: number): void {
    if (!this.running || generation !== this.generation) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick(generation);
    }, this.currentIntervalMs());
  }

  private async tick(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (this.inFlight) {
      // A previous walk is still resolving: wait for it, then reschedule.
      await this.inFlight;
      this.schedule(generation);
      return;
    }
    const run = this.walk(generation);
    this.inFlight = run;
    try {
      await run;
    } finally {
      this.inFlight = null;
    }
    this.schedule(generation);
  }

  private async walk(generation: number): Promise<void> {
    const pc = this.options.pc();
    if (!pc || this.consumers.size === 0) return;
    let report: RTCStatsReport;
    try {
      this.walks++;
      report = await pc.getStats();
    } catch (error) {
      log.debug("getStats failed", error);
      return;
    }
    if (generation !== this.generation) return;
    if (this.options.pc() !== pc) return;
    const now = Date.now();
    const elapsedMs = this.lastTickAt === null ? 0 : now - this.lastTickAt;
    this.lastTickAt = now;
    const tick: StatsTick = { report, pc, now, elapsedMs };
    for (const consumer of Array.from(this.consumers)) {
      try {
        consumer(tick);
      } catch (error) {
        log.warn("Stats consumer threw", error);
      }
    }
  }
}
