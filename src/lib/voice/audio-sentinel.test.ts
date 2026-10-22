import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboundAudioSentinel } from "./audio-sentinel";

function stats(bytesSent: number, packetsSent = 10): RTCStatsReport {
  return new Map([
    [
      "audio",
      {
        type: "outbound-rtp",
        kind: "audio",
        bytesSent,
        packetsSent,
      },
    ],
  ]) as unknown as RTCStatsReport;
}

function createPeerConnection(getStats: () => Promise<RTCStatsReport>) {
  const state = {
    connectionState: "connected" as RTCPeerConnectionState,
    iceConnectionState: "connected" as RTCIceConnectionState,
  };
  return {
    pc: {
      get connectionState() {
        return state.connectionState;
      },
      get iceConnectionState() {
        return state.iceConnectionState;
      },
      getStats,
    } as unknown as RTCPeerConnection,
    state,
  };
}

function createTrack(enabled = true) {
  return {
    enabled,
    kind: "audio",
    readyState: "live",
  } as MediaStreamTrack;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("OutboundAudioSentinel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports one stall after enabled audio RTP stops increasing", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockResolvedValue(stats(100));
    const connection = createPeerConnection(getStats);
    const track = createTrack();
    const sentinel = new OutboundAudioSentinel({
      pc: () => connection.pc,
      track: () => track,
      onStall,
      intervalMs: 10,
      stallThresholdTicks: 2,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(30);

    expect(onStall).toHaveBeenCalledOnce();
    expect(onStall).toHaveBeenCalledWith(
      expect.objectContaining({ bytesSent: 100, packetsSent: 10 }),
    );
    sentinel.stop();
  });

  it("reports first outbound RTP once when bytes are observed", async () => {
    vi.useFakeTimers();
    const onFirstRtp = vi.fn();
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockResolvedValue(stats(40));
    const connection = createPeerConnection(getStats);
    const track = createTrack();
    const sentinel = new OutboundAudioSentinel({
      pc: () => connection.pc,
      track: () => track,
      onStall: vi.fn(),
      onFirstRtp,
      intervalMs: 10,
      stallThresholdTicks: 5,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(30);

    expect(onFirstRtp).toHaveBeenCalledOnce();
    sentinel.stop();
  });

  it("ignores disabled tracks and disconnected peer connections", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockResolvedValue(stats(100));
    const connection = createPeerConnection(getStats);
    const track = createTrack(false);
    const sentinel = new OutboundAudioSentinel({
      pc: () => connection.pc,
      track: () => track,
      onStall,
      intervalMs: 10,
      stallThresholdTicks: 2,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(30);
    connection.state.connectionState = "disconnected";
    track.enabled = true;
    await vi.advanceTimersByTimeAsync(30);

    expect(onStall).not.toHaveBeenCalled();
    sentinel.stop();
  });

  it("does not treat packet progress with unchanged bytes as a stall", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    let packetsSent = 10;
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockImplementation(async () => stats(100, packetsSent++));
    const connection = createPeerConnection(getStats);
    const sentinel = new OutboundAudioSentinel({
      pc: () => connection.pc,
      track: () => createTrack(),
      onStall,
      intervalMs: 10,
      stallThresholdTicks: 2,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(30);

    expect(onStall).not.toHaveBeenCalled();
    sentinel.stop();
  });

  it("reports recovery after outbound RTP resumes", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const onRecover = vi.fn();
    let bytesSent = 100;
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockImplementation(async () => stats(bytesSent));
    const connection = createPeerConnection(getStats);
    const track = createTrack();
    const sentinel = new OutboundAudioSentinel({
      pc: () => connection.pc,
      track: () => track,
      onStall,
      onRecover,
      intervalMs: 10,
      stallThresholdTicks: 2,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(30);
    bytesSent = 150;
    await vi.advanceTimersByTimeAsync(10);

    expect(onStall).toHaveBeenCalledOnce();
    expect(onRecover).toHaveBeenCalledOnce();
    sentinel.stop();
  });

  it("discards stats that finish after the peer connection is replaced", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const firstStats = deferred<RTCStatsReport>();
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockReturnValueOnce(firstStats.promise)
      .mockResolvedValue(stats(100));
    const firstConnection = createPeerConnection(getStats);
    let currentConnection = firstConnection.pc;
    let currentTrack = createTrack();
    const sentinel = new OutboundAudioSentinel({
      pc: () => currentConnection,
      track: () => currentTrack,
      onStall,
      intervalMs: 10,
      stallThresholdTicks: 2,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(10);
    const replacement = createPeerConnection(getStats);
    currentConnection = replacement.pc;
    currentTrack = createTrack();
    firstStats.resolve(stats(100));
    await vi.advanceTimersByTimeAsync(0);

    expect(onStall).not.toHaveBeenCalled();
    sentinel.stop();
  });

  it("does not let a stopped generation reset a restarted sentinel", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const firstStats = deferred<RTCStatsReport>();
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockReturnValueOnce(firstStats.promise)
      .mockResolvedValue(stats(100));
    const connection = createPeerConnection(getStats);
    const track = createTrack();
    const sentinel = new OutboundAudioSentinel({
      pc: () => connection.pc,
      track: () => track,
      onStall,
      intervalMs: 10,
      stallThresholdTicks: 2,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(10);
    sentinel.stop();
    sentinel.start();
    await vi.advanceTimersByTimeAsync(20);
    firstStats.resolve(stats(100));
    await vi.advanceTimersByTimeAsync(10);

    expect(onStall).toHaveBeenCalledOnce();
    sentinel.stop();
  });

  it("keeps a stall latched across a counter reset until RTP resumes", async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const onRecover = vi.fn();
    const values = [100, 100, 100, 50, 50, 75];
    const getStats = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockImplementation(async () => stats(values.shift() ?? 75));
    const connection = createPeerConnection(getStats);
    const track = createTrack();
    const sentinel = new OutboundAudioSentinel({
      pc: () => connection.pc,
      track: () => track,
      onStall,
      onRecover,
      intervalMs: 10,
      stallThresholdTicks: 2,
    });

    sentinel.start();
    await vi.advanceTimersByTimeAsync(60);

    expect(onStall).toHaveBeenCalledOnce();
    expect(onRecover).toHaveBeenCalledOnce();
    sentinel.stop();
  });
});
