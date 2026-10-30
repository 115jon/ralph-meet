/**
 * Dev-only voice stats fixtures (mounted by UiFixtures): the real details
 * popover and debug screen fed by a stub SFU with deterministic samples, so
 * the dithered charts can be shot at 390 / 1440 in every theme.
 *
 *   voice-debug           full debug screen, Transport section
 *   voice-debug-inbound   full debug screen, the first inbound track
 *   voice-debug-details   details popover (drawer on phones), Connection tab
 *   voice-debug-warmup    details popover a few seconds into the call
 *
 * The stub never ticks: one snapshot, delivered on subscribe, so every
 * capture of a surface is identical.
 */

import type { SFUClient, VoiceConnectionStats } from "@/lib/sfu-client";
import type { ConnectionSample } from "@/lib/types";
import { VoiceDebugScreen } from "@/components/voice/VoiceDebugScreen";
import { VoiceDetailsPanel } from "@/components/voice/VoiceDetailsPanel";
import { useEffect, useMemo, useState, type ReactNode } from "react";

const noop = () => {};
// The latest sample lands at page load, so "Last sample" reads as live.
const T0 = Math.floor(Date.now() / 1000) * 1000;
const TICK_MS = 2000;
const TRACKS = [
  { track_name: "cam-audio-3f9c2a71", participant_id: "p-ada", kind: "audio" },
  {
    track_name: "cam-audio-8b41d0e6",
    participant_id: "p-grace",
    kind: "audio",
  },
];

/** A steady call with one rough patch two-thirds of the way through. */
function buildSeries(count: number) {
  const samples: ConnectionSample[] = [];
  const transport: ReturnType<SFUClient["getDebugData"]>["transportHistory"] =
    [];
  const inbound: Record<string, unknown[]> = {};
  let sent = 0;
  let received = 0;
  let bytesSent = 0;
  let bytesReceived = 0;
  for (let i = 0; i < count; i++) {
    const at = count - 1 - i; // ticks before now
    const k = 59 - at; // position in a full 60-sample window
    const wobble = (f: number) => Math.sin(k * f + f * 3.1);
    const rough = Math.exp(-((k - 38) ** 2) / 4);
    const t = T0 - at * TICK_MS;
    const bitrate = Math.round(
      58 + 3 * wobble(0.7) + 2 * wobble(1.9) - 26 * rough,
    );
    samples.push({
      t,
      bitrate,
      loss:
        Math.round(
          (3.8 * rough + (k === 14 ? 0.6 : 0) + (k === 50 ? 0.4 : 0)) * 10,
        ) / 10,
      jitter: Math.round(6 + 1.5 * wobble(1.3) + 17 * rough),
      rtt: Math.round(44 + 3 * wobble(0.9) + 2 * wobble(2.3) + 118 * rough),
    });
    sent += 100;
    received += 196;
    bytesSent += Math.round((bitrate * 1000 * 2) / 8);
    bytesReceived += Math.round((112_000 * 2) / 8);
    transport.push({
      time: new Date(t).toISOString().slice(11, 16),
      timestamp: t,
      availableOutgoingBitrate: Math.round(
        (1_840 + 160 * wobble(0.4) - 1_100 * rough) * 1000,
      ),
      ping: samples[i]!.rtt,
      outboundBitrate: bitrate * 1000,
      inboundBitrate: Math.round((112 + 4 * wobble(1.1) - 30 * rough) * 1000),
      packetsReceived: received,
      packetsSent: sent,
      bytesReceived,
      bytesSent,
    });
    TRACKS.forEach((track, n) => {
      const list = (inbound[track.track_name] ??= []);
      const lostSoFar = Math.round(
        (n === 0 ? 9 : 2) / (1 + Math.exp(-(k - 38))),
      );
      list.push({
        time: transport[i]!.time,
        timestamp: t,
        bitrate: Math.round((56 + 3 * wobble(0.8 + n) - 18 * rough) * 1000),
        packetsReceived: (i + 1) * 98,
        packetsLost: lostSoFar,
        jitter: (5 + 1.2 * wobble(1.7 + n) + (n === 0 ? 14 : 6) * rough) / 1000,
      });
    });
  }
  return {
    samples,
    transport,
    inbound,
    sent,
    received,
    bytesSent,
    bytesReceived,
  };
}

function buildStub(count: number): SFUClient {
  const series = buildSeries(count);
  const last = series.samples[series.samples.length - 1]!;
  const stats: VoiceConnectionStats = {
    ping: last.rtt,
    avgPing: Math.round(
      series.samples.reduce((sum, s) => sum + s.rtt, 0) / series.samples.length,
    ),
    pingHistory: [],
    jitter: last.jitter,
    samples: series.samples,
    localAddress: "192.168.1.24:51034",
    remoteAddress: "141.101.90.1:3478 (relay)",
    packetsSent: series.sent,
    packetsReceived: series.received,
    packetsLost: 12,
    packetLossRate: 12 / (series.sent + 12),
    bytesSent: series.bytesSent,
    bytesReceived: series.bytesReceived,
    availableOutgoingBitrate: series.transport.at(-1)!.availableOutgoingBitrate,
    outboundBitrate: last.bitrate * 1000,
    inboundBitrate: series.transport.at(-1)!.inboundBitrate,
    codec: { name: "opus", id: 111 },
    audioLevel: 0,
    sampleRate: 48000,
    framesEncoded: count * 100,
    timestamp: last.t,
    serverIdentifier: "ralph-hq-lounge",
    connectionState: "connected",
    publishConnectionState: "connected",
    subscribeConnectionState: "connected",
    remoteTrackCount: TRACKS.length,
  };
  const stub = {
    getConnectionState: () => "connected",
    getPublishConnectionState: () => "connected",
    getSubscribeConnectionState: () => "connected",
    subscribeConnectionStats: (cb: (s: VoiceConnectionStats) => void) => {
      cb(stats);
      return noop;
    },
    getDebugData: () => ({
      connectionState: "connected",
      participantId: "p-me-5d2e",
      roomSlug: "ralph-hq-lounge",
      transportHistory: series.transport,
      inboundHistory: series.inbound,
      connStats: stats,
      pulledTracks: TRACKS,
    }),
    getDetailedStats: async () => ({}),
  };
  return stub as unknown as SFUClient;
}

function DetailsFixture({ count, shell }: { count: number; shell: ReactNode }) {
  const sfu = useMemo(() => buildStub(count), [count]);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  return (
    <div className="relative h-full w-full">
      {shell}
      <button
        type="button"
        ref={setAnchor}
        aria-label="Voice connection details"
        className="fixed bottom-3 left-4 z-20 size-8 rounded-full bg-rm-tint-2"
      />
      {anchor ? (
        <VoiceDetailsPanel
          sfu={sfu}
          isOpen
          onClose={noop}
          triggerRef={anchorRef}
          channelName="Lounge"
        />
      ) : null}
    </div>
  );
}

function DebugFixture({ inbound }: { inbound: boolean }) {
  const sfu = useMemo(() => buildStub(60), []);
  // The section is the screen's own state: press the first inbound item.
  useEffect(() => {
    if (!inbound) return;
    const id = window.setTimeout(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent?.includes("3f9c2a71"))
        ?.click();
    }, 300);
    return () => window.clearTimeout(id);
  }, [inbound]);
  return <VoiceDebugScreen sfu={sfu} onClose={noop} channelName="Lounge" />;
}

export function VoiceDebugFixture({
  surface,
  shell,
}: {
  surface: string;
  shell: ReactNode;
}) {
  switch (surface) {
    case "voice-debug-details":
      return <DetailsFixture count={60} shell={shell} />;
    case "voice-debug-warmup":
      return <DetailsFixture count={5} shell={shell} />;
    default:
      return <DebugFixture inbound={surface === "voice-debug-inbound"} />;
  }
}
