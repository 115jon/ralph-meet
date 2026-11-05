import { describe, expect, it, vi } from "vitest";
import { readReceiverFrames, RemoteVideoHealth } from "../remote-video-health";
import type { VideoFrameReading } from "../video-flow";
import type { VideoRenderDemandSource } from "../video-render-demand";

function track(id: string): MediaStreamTrack {
  return { id, kind: "video" } as unknown as MediaStreamTrack;
}

function setup() {
  let now = 0;
  const frames = new Map<MediaStreamTrack, number | null>();
  const shown = new Set<MediaStreamTrack>();
  const renderDemand: VideoRenderDemandSource = {
    largestRenderFor: (candidate) =>
      shown.has(candidate) ? { width: 640, height: 360 } : null,
    subscribe: () => () => {},
  };
  const recover = vi.fn((_trackName: string) => true);
  const timers: Array<() => void> = [];
  const health = new RemoteVideoHealth({
    readFrames: (candidate): VideoFrameReading | null => {
      const count = frames.get(candidate);
      return count === null || count === undefined
        ? null
        : { frames: count, at: now };
    },
    recover,
    renderDemand,
    firstFrameTimeoutMs: 6_000,
    stallAfterMs: 5_000,
    now: () => now,
    schedule: (run) => {
      timers.push(run);
      return () => {
        const index = timers.indexOf(run);
        if (index >= 0) timers.splice(index, 1);
      };
    },
  });
  const notified = vi.fn();
  health.subscribe(notified);
  /** Moves the clock and takes one round of readings. */
  const at = async (ms: number) => {
    now = ms;
    await health.check();
  };
  return { health, frames, shown, recover, timers, notified, at };
}

describe("RemoteVideoHealth", () => {
  it("measures a shown camera from its first frame and notifies changes", async () => {
    const { health, frames, shown, notified, at, timers } = setup();
    const camera = track("camera");
    health.watch("cam-video-a", camera);
    expect(timers).toHaveLength(1);
    shown.add(camera);
    frames.set(camera, 0);
    await at(0);
    expect(health.flowOf(camera)).toBe("waiting");
    frames.set(camera, 30);
    await at(2_000);
    expect(health.flowOf(camera)).toBe("playing");
    expect(notified).toHaveBeenCalledTimes(2);
    health.unwatch(camera);
    expect(health.flowOf(camera)).toBeUndefined();
    expect(timers).toHaveLength(0);
  });

  it("pulls a camera that never decodes again once, then reports it stalled", async () => {
    const { health, frames, shown, recover, at } = setup();
    const first = track("first");
    health.watch("cam-video-a", first);
    shown.add(first);
    frames.set(first, 0);
    await at(0);
    await at(6_000);
    expect(recover).toHaveBeenCalledExactlyOnceWith("cam-video-a");
    // The manager removes the stalled track and pulls the alias again.
    health.unwatch(first);

    const second = track("second");
    health.watch("cam-video-a", second);
    // The re-pull's track waits from the start: no black frame meanwhile.
    expect(health.flowOf(second)).toBe("waiting");
    shown.add(second);
    frames.set(second, 0);
    await at(7_000);
    // Its new connection gets longer than the call's for a first frame.
    await at(12_000);
    expect(health.flowOf(second)).toBe("waiting");
    await at(16_000);
    expect(health.flowOf(second)).toBe("stalled");
    // One attempt per episode: no loop against a publisher that is gone.
    expect(recover).toHaveBeenCalledOnce();

    // Frames come back: it plays, and a later stall may be recovered again.
    frames.set(second, 10);
    await at(17_000);
    expect(health.flowOf(second)).toBe("playing");
    await at(22_000);
    expect(health.flowOf(second)).toBe("stalled");
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("gives a re-pull's track the recovered first-frame timeout, even after it was off screen", async () => {
    const { health, frames, shown, at } = setup();
    const first = track("first");
    health.watch("cam-video-a", first);
    shown.add(first);
    frames.set(first, 0);
    await at(0);
    await at(6_000);
    health.unwatch(first);

    const second = track("second");
    health.watch("cam-video-a", second);
    frames.set(second, 0);
    // Hidden for a reading (its measure is dropped), then shown again.
    await at(7_000);
    shown.add(second);
    await at(8_000);
    await at(17_000);
    // A slow connection: the first frame lands 9 s after it was shown.
    expect(health.flowOf(second)).toBe("waiting");
    frames.set(second, 3);
    await at(17_500);
    expect(health.flowOf(second)).toBe("playing");
  });

  it("starts a new episode when the alias ends", async () => {
    const { health, frames, shown, recover, at } = setup();
    const first = track("first");
    health.watch("cam-video-a", first);
    shown.add(first);
    frames.set(first, 0);
    await at(0);
    await at(6_000);
    health.unwatch(first);
    // The camera went off and came back on.
    health.forget("cam-video-a");
    const second = track("second");
    health.watch("cam-video-a", second);
    shown.add(second);
    frames.set(second, 0);
    await at(7_000);
    await at(13_000);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("does not measure a camera nothing shows, and starts afresh when shown", async () => {
    const { health, frames, shown, recover, at } = setup();
    const camera = track("camera");
    health.watch("cam-video-a", camera);
    frames.set(camera, 0);
    await at(0);
    await at(20_000);
    expect(health.flowOf(camera)).toBeUndefined();
    shown.add(camera);
    await at(21_000);
    expect(health.flowOf(camera)).toBe("waiting");
    shown.delete(camera);
    await at(40_000);
    shown.add(camera);
    await at(41_000);
    expect(health.flowOf(camera)).toBe("waiting");
    expect(recover).not.toHaveBeenCalled();
  });

  it("leaves a camera whose stats cannot be read playing", async () => {
    const { health, frames, shown, recover, at } = setup();
    const camera = track("camera");
    health.watch("cam-video-a", camera);
    shown.add(camera);
    frames.set(camera, null);
    await at(0);
    await at(30_000);
    expect(health.flowOf(camera)).toBe("playing");
    expect(recover).not.toHaveBeenCalled();
  });

  it("treats a failed read as unreadable, and stops when disposed", async () => {
    const recover = vi.fn(() => true);
    const camera = track("camera");
    const timers: Array<() => void> = [];
    const health = new RemoteVideoHealth({
      readFrames: () => Promise.reject(new Error("closed")),
      recover,
      renderDemand: {
        largestRenderFor: () => ({ width: 1, height: 1 }),
        subscribe: () => () => {},
      },
      schedule: (run) => {
        timers.push(run);
        return () => timers.splice(timers.indexOf(run), 1);
      },
    });
    health.watch("cam-video-a", camera);
    await health.check();
    expect(health.flowOf(camera)).toBe("playing");
    health.dispose();
    expect(timers).toHaveLength(0);
    expect(health.flowOf(camera)).toBeUndefined();
  });
});

describe("readReceiverFrames", () => {
  const receiver = (entries: object[]) =>
    ({
      getStats: async () =>
        new Map(entries.map((entry, i) => [`s${i}`, entry])),
    }) as unknown as RTCRtpReceiver;

  it("reads the receiver's decoded video frames", async () => {
    const reading = await readReceiverFrames(
      receiver([
        { type: "codec" },
        { type: "inbound-rtp", kind: "video", framesDecoded: 42 },
      ]),
      () => 7,
    );
    expect(reading).toEqual({ frames: 42, at: 7 });
  });

  it("reads zero frames before anything arrived (no inbound-rtp yet)", async () => {
    // A pull answered on a recycled MID never receives a packet.
    expect(await readReceiverFrames(receiver([]), () => 7)).toEqual({
      frames: 0,
      at: 7,
    });
  });
});
