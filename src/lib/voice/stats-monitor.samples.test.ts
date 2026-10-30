import { describe, expect, it } from "vitest";
import type { VoiceConnectionStats } from "../sfu-client";
import {
  CONNECTION_SAMPLE_CAPACITY,
  ConnectionStatsMonitor,
  type StatsAccessor,
} from "./stats-monitor";

function report(entries: Record<string, unknown>[]): RTCStatsReport {
  return new Map(
    entries.map((entry) => [entry.id as string, entry]),
  ) as unknown as RTCStatsReport;
}

const accessor: StatsAccessor = {
  getPushPC: () => null,
  getPullPC: () => null,
  getPulledTracks: () => [],
  getRoomSlug: () => "room",
  getParticipantId: () => "me",
  getConnectionState: () => "connected",
  getPublishConnectionState: () => "connected",
  getSubscribeConnectionState: () => "connected",
};

/** One tick's report: audio out, the SFU's receiver report, a transport. */
function tick(opts: {
  bytesSent: number;
  packetsSent: number;
  packetsLost: number;
  jitter: number;
  rtt: number;
  fractionLost?: number;
}) {
  return report([
    {
      id: "out",
      type: "outbound-rtp",
      kind: "audio",
      bytesSent: opts.bytesSent,
      packetsSent: opts.packetsSent,
    },
    {
      id: "rin",
      type: "remote-inbound-rtp",
      kind: "audio",
      packetsLost: opts.packetsLost,
      jitter: opts.jitter,
      roundTripTime: opts.rtt,
      ...(opts.fractionLost === undefined
        ? {}
        : { fractionLost: opts.fractionLost }),
    },
    {
      id: "tr",
      type: "transport",
      bytesSent: opts.bytesSent,
      packetsSent: opts.packetsSent,
    },
  ]);
}

describe("ConnectionStatsMonitor samples", () => {
  it("records per-interval bitrate, loss, jitter and RTT on each tick", () => {
    const monitor = new ConnectionStatsMonitor(accessor);
    const seen: VoiceConnectionStats[] = [];
    monitor.subscribeConnectionStats((s) => seen.push(s));

    monitor.ingestConnectionStats(
      tick({
        bytesSent: 0,
        packetsSent: 0,
        packetsLost: 0,
        jitter: 0.004,
        rtt: 0.05,
      }),
      null,
      1_000,
    );
    // 2 s later: 16 000 bytes (64 kbps), 100 packets sent, 2 more lost.
    monitor.ingestConnectionStats(
      tick({
        bytesSent: 16_000,
        packetsSent: 98,
        packetsLost: 2,
        jitter: 0.0123,
        rtt: 0.08,
      }),
      null,
      3_000,
    );

    const latest = seen.at(-1)!;
    expect(latest.jitter).toBe(12.3);
    expect(latest.samples).toHaveLength(2);
    expect(latest.samples[1]).toEqual({
      t: 3_000,
      bitrate: 64,
      loss: 2,
      jitter: 12.3,
      rtt: 80,
    });
  });

  it("prefers the receiver report's fractionLost when present", () => {
    const monitor = new ConnectionStatsMonitor(accessor);
    monitor.ingestConnectionStats(
      tick({
        bytesSent: 0,
        packetsSent: 0,
        packetsLost: 0,
        jitter: 0,
        rtt: 0.05,
        fractionLost: 0.034,
      }),
      null,
      1_000,
    );
    expect(monitor.getConnectionStats()!.samples[0]!.loss).toBe(3.4);
  });

  it("keeps a bounded ring and clears it on a new session", () => {
    const monitor = new ConnectionStatsMonitor(accessor);
    for (let i = 0; i < CONNECTION_SAMPLE_CAPACITY + 5; i++) {
      monitor.ingestConnectionStats(
        tick({
          bytesSent: i * 1000,
          packetsSent: i * 50,
          packetsLost: 0,
          jitter: 0,
          rtt: 0.05,
        }),
        null,
        i * 2000,
      );
    }
    const { samples } = monitor.getConnectionStats()!;
    expect(samples).toHaveLength(CONNECTION_SAMPLE_CAPACITY);
    expect(samples[0]!.t).toBe(5 * 2000);

    monitor.beginConnectionStatsSession();
    monitor.ingestConnectionStats(
      tick({
        bytesSent: 0,
        packetsSent: 0,
        packetsLost: 0,
        jitter: 0,
        rtt: 0.05,
      }),
      null,
      999_000,
    );
    expect(monitor.getConnectionStats()!.samples).toHaveLength(1);
  });

  it("pushes after the debug series, so a listener reads this tick", () => {
    const monitor = new ConnectionStatsMonitor(accessor);
    const lengths: number[] = [];
    monitor.subscribeConnectionStats(() =>
      lengths.push(monitor.getDebugData().transportHistory.length),
    );
    monitor.ingestConnectionStats(
      tick({
        bytesSent: 0,
        packetsSent: 0,
        packetsLost: 0,
        jitter: 0,
        rtt: 0.05,
      }),
      null,
      1_000,
    );
    expect(lengths).toEqual([1]);
  });
});
