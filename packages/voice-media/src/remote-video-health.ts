import { scheduleWithGlobalTimers, type ScheduleTimer } from "@ralph/realtime";
import {
  VIDEO_RECOVERED_FIRST_FRAME_TIMEOUT_MS,
  VideoFlowDetector,
  type VideoFlow,
  type VideoFlowOptions,
  type VideoFrameReading,
} from "./video-flow";
import type { VideoRenderDemandSource } from "./video-render-demand";

/** Reads a pulled track's decoded frame count; null when it cannot. */
export type ReadVideoFrames = (
  track: MediaStreamTrack,
) => Promise<VideoFrameReading | null> | VideoFrameReading | null;

/** What a tile reads: a shown track's flow, and when flows change. */
export interface RemoteVideoHealthSource {
  /** undefined for a track nothing measures (not a camera, not on screen). */
  flowOf(track: MediaStreamTrack): VideoFlow | undefined;
  subscribe(listener: () => void): () => void;
}

export interface RemoteVideoHealthOptions extends VideoFlowOptions {
  readonly readFrames: ReadVideoFrames;
  /**
   * Pulls the alias again on a fresh path (see
   * PartyTracksMediaManager.recoverRemoteVideo); false when it could not.
   */
  readonly recover: (trackName: string) => boolean;
  /** Only tracks on screen are measured: nothing else needs to play. */
  readonly renderDemand: VideoRenderDemandSource;
  /**
   * firstFrameTimeoutMs for a re-pull's track, which also waits for its new
   * peer connection to connect.
   */
  readonly recoveredFirstFrameTimeoutMs?: number;
  readonly intervalMs?: number;
  readonly schedule?: ScheduleTimer;
  /** The clock readings are taken on (VideoFrameReading.at). */
  readonly now?: () => number;
}

/** Twice the web's stats tick, so most readings are fresh ones. */
export const REMOTE_VIDEO_HEALTH_INTERVAL_MS = 2_000;

interface Watched {
  readonly trackName: string;
  readonly track: MediaStreamTrack;
  detector: VideoFlowDetector | null;
}

/**
 * Measures the remote cameras on screen and pulls a stalled one again once.
 *
 * A camera that stalls (no first frame, or no new frame for a while) is
 * pulled again on a fresh path: one attempt per alias until a track of it
 * plays again, so a publisher whose uplink is gone is not re-pulled in a
 * loop. A stall after that attempt stays "stalled" (the tile says the video
 * is unavailable) until frames come back.
 *
 * Off screen a track is not measured, and starts afresh when it is shown
 * again: a hidden tile must not count as a stall.
 */
export class RemoteVideoHealth implements RemoteVideoHealthSource {
  private readonly watched = new Map<MediaStreamTrack, Watched>();
  /** Aliases re-pulled since a track of theirs last played. */
  private readonly recovered = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly options: RemoteVideoHealthOptions;
  private readonly schedule: ScheduleTimer;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private cancelTick: (() => void) | null = null;
  private inFlight = false;
  private disposed = false;

  constructor(options: RemoteVideoHealthOptions) {
    this.options = options;
    this.schedule = options.schedule ?? scheduleWithGlobalTimers;
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? REMOTE_VIDEO_HEALTH_INTERVAL_MS;
  }

  /** A remote camera track is shown (the manager's onRemoteTrack add). */
  watch(trackName: string, track: MediaStreamTrack): void {
    if (this.disposed || this.watched.has(track)) return;
    // A re-pull's track is waiting from the start, so its tile shows the
    // loading state rather than black until the first reading. Any other
    // new track shows as before until it is measured.
    const detector = this.recovered.has(trackName)
      ? this.detectorFor(trackName)
      : null;
    this.watched.set(track, { trackName, track, detector });
    if (detector) this.notify();
    this.ensureTicking();
  }

  /** The track is hidden or gone. */
  unwatch(track: MediaStreamTrack): void {
    const watched = this.watched.get(track);
    if (!watched) return;
    this.watched.delete(track);
    if (watched.detector) this.notify();
    if (this.watched.size === 0) this.stopTicking();
  }

  /** The alias ended (camera off, the participant left): a new episode. */
  forget(trackName: string): void {
    this.recovered.delete(trackName);
  }

  flowOf(track: MediaStreamTrack): VideoFlow | undefined {
    return this.watched.get(track)?.detector?.flow;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.stopTicking();
    this.watched.clear();
    this.recovered.clear();
    this.listeners.clear();
  }

  /** One round of readings (the timer's; tests call it directly). */
  async check(): Promise<void> {
    if (this.disposed || this.inFlight) return;
    this.inFlight = true;
    let changed = false;
    try {
      const entries = [...this.watched.values()];
      const readings = await Promise.all(
        entries.map((entry) =>
          this.isShown(entry.track)
            ? Promise.resolve(this.options.readFrames(entry.track)).catch(
                () => null,
              )
            : Promise.resolve(undefined),
        ),
      );
      if (this.disposed) return;
      entries.forEach((entry, index) => {
        // Unwatched while reading.
        if (this.watched.get(entry.track) !== entry) return;
        const reading = readings[index];
        if (reading === undefined) {
          // Off screen: forget the measure, start afresh when shown.
          if (entry.detector) changed = true;
          entry.detector = null;
          return;
        }
        if (!entry.detector) {
          entry.detector = this.detectorFor(entry.trackName);
          changed = true;
        }
        const before = entry.detector.flow;
        const flow = entry.detector.sample(reading);
        if (flow !== before) changed = true;
        if (flow === "playing" && reading)
          this.recovered.delete(entry.trackName);
        if (flow === "stalled" && before !== "stalled") {
          this.onStalled(entry);
        }
      });
    } finally {
      this.inFlight = false;
    }
    if (changed) this.notify();
  }

  /** A re-pull's track gets longer for its first frame (see the option). */
  private detectorFor(trackName: string): VideoFlowDetector {
    if (!this.recovered.has(trackName)) {
      return new VideoFlowDetector(this.now(), this.options);
    }
    return new VideoFlowDetector(this.now(), {
      firstFrameTimeoutMs:
        this.options.recoveredFirstFrameTimeoutMs ??
        VIDEO_RECOVERED_FIRST_FRAME_TIMEOUT_MS,
      stallAfterMs: this.options.stallAfterMs,
    });
  }

  private onStalled(entry: Watched): void {
    if (this.recovered.has(entry.trackName)) return;
    this.recovered.add(entry.trackName);
    // Removes this track (unwatch) and pulls the alias again.
    this.options.recover(entry.trackName);
  }

  private isShown(track: MediaStreamTrack): boolean {
    return this.options.renderDemand.largestRenderFor(track) !== null;
  }

  private ensureTicking(): void {
    if (this.cancelTick || this.disposed) return;
    const tick = () => {
      this.cancelTick = this.schedule(tick, this.intervalMs);
      void this.check();
    };
    this.cancelTick = this.schedule(tick, this.intervalMs);
  }

  private stopTicking(): void {
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * A receiver's decoded video frames, from its own stats report. No
 * inbound-rtp entry means nothing has arrived yet (libwebrtc makes it on the
 * first packet): zero frames, so a pull that never receives (a recycled
 * MID) is seen as not playing.
 */
export async function readReceiverFrames(
  receiver: RTCRtpReceiver,
  now: () => number = Date.now,
): Promise<VideoFrameReading> {
  const report = await receiver.getStats();
  let frames = 0;
  report.forEach(
    (entry: { type?: string; kind?: string; framesDecoded?: number }) => {
      if (entry.type === "inbound-rtp" && entry.kind === "video") {
        frames = Math.max(frames, entry.framesDecoded ?? 0);
      }
    },
  );
  return { frames, at: now() };
}
