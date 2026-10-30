import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioSentinel, OutboundAudioSentinel } from "./audio-sentinel";
import { StatsHub } from "./stats-hub";

function report(entries: Record<string, unknown>[]): RTCStatsReport {
  return new Map(
    entries.map((entry, index) => [`r${index}`, entry]),
  ) as unknown as RTCStatsReport;
}

function connectedPc(getStats: () => Promise<RTCStatsReport>) {
  return {
    connectionState: "connected",
    iceConnectionState: "connected",
    getStats,
  } as unknown as RTCPeerConnection;
}

describe("StatsHub", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes one walk per tick at 2 s and fans it out to every consumer", async () => {
    vi.useFakeTimers();
    const getStats = vi.fn(async () => report([]));
    const pc = connectedPc(getStats);
    const hub = new StatsHub({ pc: () => pc });
    const a = vi.fn();
    const b = vi.fn();
    hub.addConsumer(a);
    hub.addConsumer(b);

    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getStats).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toMatchObject({ pc, elapsedMs: 0 });

    await vi.advanceTimersByTimeAsync(6000);
    expect(getStats).toHaveBeenCalledTimes(4);
    expect(a).toHaveBeenCalledTimes(4);
    expect(b).toHaveBeenCalledTimes(4);
    expect(a.mock.calls[1][0].report).toBe(b.mock.calls[1][0].report);
    expect(a.mock.calls[1][0].elapsedMs).toBe(2000);

    hub.stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(getStats).toHaveBeenCalledTimes(4);
  });

  it("drops to 1 s only while a consumer is suspect", async () => {
    vi.useFakeTimers();
    const getStats = vi.fn(async () => report([]));
    let suspect = false;
    const hub = new StatsHub({
      pc: () => connectedPc(getStats),
      isSuspect: () => suspect,
    });
    hub.addConsumer(() => {});
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    suspect = true;
    await vi.advanceTimersByTimeAsync(2000);
    // The pending 2 s tick fires, then the chain runs at 1 s.
    await vi.advanceTimersByTimeAsync(3000);
    expect(getStats).toHaveBeenCalledTimes(5);
    suspect = false;
    await vi.advanceTimersByTimeAsync(1000);
    const before = getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(getStats.mock.calls.length - before).toBe(2);
    hub.stop();
  });

  it("skips the walk when nothing listens or there is no peer connection", async () => {
    vi.useFakeTimers();
    const getStats = vi.fn(async () => report([]));
    let pc: RTCPeerConnection | null = null;
    const hub = new StatsHub({ pc: () => pc });
    hub.start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(getStats).not.toHaveBeenCalled();
    pc = connectedPc(getStats);
    await vi.advanceTimersByTimeAsync(4000);
    expect(getStats).not.toHaveBeenCalled();
    hub.addConsumer(() => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect(getStats).toHaveBeenCalledTimes(1);
    hub.stop();
  });
});

describe("sentinels fed by the hub", () => {
  it("keeps the inbound stall threshold in wall-clock time at a 2 s cadence", () => {
    const pc = connectedPc(async () => report([]));
    const onStall = vi.fn();
    const sentinel = new AudioSentinel({
      pc: () => pc,
      onStall,
      onRecover: vi.fn(),
      stallThresholdTicks: 6,
    });
    const inbound = report([
      { type: "inbound-rtp", kind: "audio", bytesReceived: 500 },
    ]);
    sentinel.ingest(inbound, 0);
    expect(sentinel.isSuspect()).toBe(false);
    sentinel.ingest(inbound, 2000);
    expect(sentinel.isSuspect()).toBe(true);
    sentinel.ingest(inbound, 2000);
    expect(onStall).not.toHaveBeenCalled();
    // 6 s of zero delta = 6 one-second ticks.
    sentinel.ingest(inbound, 2000);
    expect(onStall).toHaveBeenCalledOnce();
  });

  it("is not suspect during remote silence", () => {
    const pc = connectedPc(async () => report([]));
    const sentinel = new AudioSentinel({
      pc: () => pc,
      onStall: vi.fn(),
      onRecover: vi.fn(),
      shouldTreatAsStall: () => false,
    });
    const inbound = report([
      { type: "inbound-rtp", kind: "audio", bytesReceived: 500 },
    ]);
    sentinel.ingest(inbound, 0);
    sentinel.ingest(inbound, 2000);
    expect(sentinel.isSuspect()).toBe(false);
  });

  it("reports an outbound stall from shared snapshots", () => {
    const pc = connectedPc(async () => report([]));
    const track = {
      enabled: true,
      kind: "audio",
      readyState: "live",
    } as MediaStreamTrack;
    const onStall = vi.fn();
    const sentinel = new OutboundAudioSentinel({
      pc: () => pc,
      track: () => track,
      onStall,
      stallThresholdTicks: 4,
    });
    const outbound = report([
      { type: "outbound-rtp", kind: "audio", bytesSent: 100, packetsSent: 5 },
    ]);
    sentinel.ingest(outbound, 0);
    sentinel.ingest(outbound, 2000);
    expect(sentinel.isSuspect()).toBe(true);
    expect(onStall).not.toHaveBeenCalled();
    sentinel.ingest(outbound, 2000);
    expect(onStall).toHaveBeenCalledOnce();
  });
});
