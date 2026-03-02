// ============================================================================
// ConnectionStatsMonitor — WebRTC stats polling, debug time-series, detailed stats
// ============================================================================

import type { VoiceConnectionStats } from "../sfu-client";
import type { TrackInfo } from "../types";

/** Accessor interface for reading SFUClient state without circular dependency */
export interface StatsAccessor {
  getPushPC(): RTCPeerConnection | null;
  getPullPC(): RTCPeerConnection | null;
  getPulledTracks(): TrackInfo[];
  getRoomSlug(): string;
  getParticipantId(): string | null;
  getConnectionState(): string;
}

export class ConnectionStatsMonitor {
  // -- Track-level stats --
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private remoteTrackStats = new Map<string, {
    fps: number; bitrate: number; width: number; height: number;
    timestamp: number; frames: number; bytes: number;
  }>();

  // -- Connection stats for Voice Details panel --
  private connStatsInterval: ReturnType<typeof setInterval> | null = null;
  private connStatsCache: VoiceConnectionStats | null = null;
  private connStatsPingHistory: { time: string; ping: number }[] = [];
  private connStatsPrevBytes: { sent: number; received: number; timestamp: number } | null = null;

  // -- Debug time-series (full debug screen) --
  private debugHistory: {
    time: string;
    availableOutgoingBitrate: number;
    ping: number;
    outboundBitrate: number;
    inboundBitrate: number;
    packetsReceived: number;
    packetsSent: number;
    bytesReceived: number;
    bytesSent: number;
  }[] = [];
  private debugInboundHistory: Map<string, {
    time: string; bitrate: number; packetsReceived: number;
    packetsLost: number; jitter: number;
  }[]> = new Map();
  private debugPrevInbound: Map<string, {
    bytes: number; packets: number; timestamp: number;
  }> = new Map();

  // -- UUID → Clerk ID mapping for getStatsByClerkId --
  private uuidToClerk = new Map<string, string>();

  private readonly accessor: StatsAccessor;

  constructor(accessor: StatsAccessor) {
    this.accessor = accessor;
  }

  /** Set a mapping from participant UUID to Clerk user ID */
  setClerkMapping(uuid: string, clerkId: string): void {
    this.uuidToClerk.set(uuid, clerkId);
  }

  /** Remove a participant's Clerk mapping */
  deleteClerkMapping(uuid: string): void {
    this.uuidToClerk.delete(uuid);
  }

  getTrackStats(trackName: string) {
    return this.remoteTrackStats.get(trackName);
  }

  getStatsByClerkId(clerkId: string, trackPrefix: 'cam' | 'screen') {
    let uuid: string | null = null;
    for (const [u, c] of Array.from(this.uuidToClerk.entries())) {
      if (c === clerkId) {
        uuid = u;
        break;
      }
    }
    if (!uuid) return null;
    return this.getTrackStats(`${trackPrefix}-video-${uuid}`);
  }

  startStatsMonitoring(): void {
    if (this.statsInterval) return;
    this.statsInterval = setInterval(async () => {
      const pullPC = this.accessor.getPullPC();
      if (!pullPC) return;
      try {
        const stats = await pullPC.getStats();
        const now = Date.now();
        const pulledTracks = this.accessor.getPulledTracks();

        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const trackId = (report as any).trackIdentifier;
            const trackInfo = pulledTracks.find(t => t.track?.id === trackId);
            if (!trackInfo) return;

            const prev = this.remoteTrackStats.get(trackInfo.track_name);
            const frames = (report as any).framesDecoded || 0;
            const bytes = (report as any).bytesReceived || 0;
            const width = (report as any).frameWidth || 0;
            const height = (report as any).frameHeight || 0;

            if (prev) {
              const dt = (now - prev.timestamp) / 1000;
              const df = frames - prev.frames;
              const db = bytes - prev.bytes;

              if (dt > 0.5) {
                const fps = Math.max(0, df / dt);
                const bitrate = Math.max(0, (db * 8) / dt);
                this.remoteTrackStats.set(trackInfo.track_name, { fps, bitrate, width, height, timestamp: now, frames, bytes });
              }
            } else {
              this.remoteTrackStats.set(trackInfo.track_name, { fps: 0, bitrate: 0, width, height, timestamp: now, frames, bytes });
            }
          }
        });
      } catch { /* ignore */ }
    }, 2000);
  }

  startConnectionStatsMonitoring(): void {
    this.stopConnectionStatsMonitoring();
    this.connStatsPingHistory = [];
    this.connStatsPrevBytes = null;
    this.connStatsCache = null;

    this.connStatsInterval = setInterval(async () => {
      const primaryPC = this.accessor.getPushPC() || this.accessor.getPullPC();
      if (!primaryPC) return;

      try {
        let stats = await primaryPC.getStats();
        const now = Date.now();
        let ping = 0;
        let localAddress = "";
        let remoteAddress = "";
        let packetsSent = 0;
        let packetsReceived = 0;
        let bytesSent = 0;
        let bytesReceived = 0;
        let availableOutgoingBitrate = 0;

        let codecName = "";
        let codecId = 0;
        let audioLevel = 0;
        let sampleRate = 48000;
        let framesEncoded = 0;
        let packetsLost = 0;

        // Helper: check if stats contain a succeeded/nominated candidate-pair
        const hasActiveCandidatePair = (s: RTCStatsReport): boolean => {
          let found = false;
          s.forEach((report: any) => {
            if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
              found = true;
            }
          });
          return found;
        };

        // If primaryPC has no active ICE pair, try the other PC
        if (!hasActiveCandidatePair(stats)) {
          const fallbackPC = primaryPC === this.accessor.getPushPC()
            ? this.accessor.getPullPC()
            : this.accessor.getPushPC();
          if (fallbackPC) {
            try {
              const fallbackStats = await fallbackPC.getStats();
              if (hasActiveCandidatePair(fallbackStats)) {
                stats = fallbackStats;
              }
            } catch { /* ignore fallback errors */ }
          }
        }

        // Collect codec IDs for lookup
        const codecMap = new Map<string, { mimeType: string; payloadType: number }>();
        stats.forEach((report: any) => {
          if (report.type === "codec") {
            codecMap.set(report.id, {
              mimeType: report.mimeType || "",
              payloadType: report.payloadType || 0,
            });
          }
        });

        stats.forEach((report: any) => {
          // Transport overall bytes
          if (report.type === "transport") {
            bytesSent = report.bytesSent || bytesSent;
            bytesReceived = report.bytesReceived || bytesReceived;
            packetsSent = report.packetsSent || packetsSent;
            packetsReceived = report.packetsReceived || packetsReceived;
          }

          // ICE candidate-pair (nominated, succeeded)
          if (
            report.type === "candidate-pair" &&
            report.state === "succeeded" &&
            report.nominated
          ) {
            ping = Math.round((report.currentRoundTripTime || 0) * 1000);
            availableOutgoingBitrate = report.availableOutgoingBitrate || availableOutgoingBitrate;

            // Resolve local/remote candidates
            const localCand = report.localCandidateId;
            const remoteCand = report.remoteCandidateId;
            if (localCand) {
              const lc = stats.get(localCand) as any;
              if (lc) localAddress = `${lc.address || lc.ip || "?"}:${lc.port || "?"}`;
            }
            if (remoteCand) {
              const rc = stats.get(remoteCand) as any;
              if (rc) remoteAddress = `${rc.address || rc.ip || "?"}:${rc.port || "?"}`;
            }
          }

          // Outbound RTP (audio)
          if (report.type === "outbound-rtp" && report.kind === "audio") {
            framesEncoded = report.framesEncoded || 0;
            packetsLost = 0;

            // Codec
            if (report.codecId && codecMap.has(report.codecId)) {
              const c = codecMap.get(report.codecId)!;
              codecName = c.mimeType.replace("audio/", "");
              codecId = c.payloadType;
            }
          }

          // Remote inbound RTP (for packet loss from receiver reports)
          if (report.type === "remote-inbound-rtp" && report.kind === "audio") {
            packetsLost = report.packetsLost || 0;
          }
        });

        // Update ping history (keep last 30 samples = ~60s at 2s interval)
        const timeStr = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        this.connStatsPingHistory.push({ time: timeStr, ping });
        if (this.connStatsPingHistory.length > 30) {
          this.connStatsPingHistory.shift();
        }

        // Calculate average ping from history
        const avgPing = this.connStatsPingHistory.length > 0
          ? Math.round(this.connStatsPingHistory.reduce((sum, p) => sum + p.ping, 0) / this.connStatsPingHistory.length)
          : ping;

        // Calculate bitrate deltas
        let outboundBitrate = 0;
        let inboundBitrate = 0;
        if (this.connStatsPrevBytes) {
          const dt = (now - this.connStatsPrevBytes.timestamp) / 1000;
          if (dt > 0.5) {
            outboundBitrate = Math.max(0, ((bytesSent - this.connStatsPrevBytes.sent) * 8) / dt);
            inboundBitrate = Math.max(0, ((bytesReceived - this.connStatsPrevBytes.received) * 8) / dt);
          }
        }
        this.connStatsPrevBytes = { sent: bytesSent, received: bytesReceived, timestamp: now };

        // Calculate packet loss rate
        const totalPackets = packetsSent + packetsLost;
        const packetLossRate = totalPackets > 0 ? packetsLost / totalPackets : 0;

        // Try to get audio level from local audio track settings
        const pushPC = this.accessor.getPushPC();
        if (pushPC) {
          const senders = pushPC.getSenders();
          for (const sender of senders) {
            if (sender.track?.kind === "audio") {
              const settings = sender.track.getSettings();
              sampleRate = settings.sampleRate || 48000;
              break;
            }
          }
        }

        // Derive server identifier from room slug
        const serverIdentifier = this.accessor.getRoomSlug() || "unknown";

        this.connStatsCache = {
          ping,
          avgPing,
          pingHistory: [...this.connStatsPingHistory],
          localAddress,
          remoteAddress,
          packetsSent,
          packetsReceived,
          packetsLost,
          packetLossRate,
          bytesSent,
          bytesReceived,
          availableOutgoingBitrate,
          outboundBitrate,
          inboundBitrate,
          codec: codecName ? { name: codecName, id: codecId } : null,
          audioLevel,
          sampleRate,
          framesEncoded,
          timestamp: now,
          serverIdentifier,
        };

        // -- Debug time-series: append transport-level history --
        this.debugHistory.push({
          time: timeStr,
          availableOutgoingBitrate,
          ping,
          outboundBitrate,
          inboundBitrate,
          packetsReceived,
          packetsSent,
          bytesReceived,
          bytesSent,
        });
        if (this.debugHistory.length > 60) this.debugHistory.shift();

        // -- Debug: collect per-track inbound stats from pullPC --
        const pullPC = this.accessor.getPullPC();
        if (pullPC) {
          try {
            const pullStats = await pullPC.getStats();
            const pullNow = Date.now();
            const pulledTracks = this.accessor.getPulledTracks();
            pullStats.forEach((report: any) => {
              if (report.type === "inbound-rtp") {
                const trackInfo = pulledTracks.find(t => t.track?.id === report.trackIdentifier);
                const trackName = trackInfo?.track_name || `ssrc-${report.ssrc}`;
                const prev = this.debugPrevInbound.get(trackName);
                const bytes = report.bytesReceived || 0;
                const pkts = report.packetsReceived || 0;

                let bitrate = 0;
                if (prev) {
                  const dt = (pullNow - prev.timestamp) / 1000;
                  if (dt > 0.5) {
                    bitrate = Math.max(0, ((bytes - prev.bytes) * 8) / dt);
                  }
                }
                this.debugPrevInbound.set(trackName, { bytes, packets: pkts, timestamp: pullNow });

                if (!this.debugInboundHistory.has(trackName)) {
                  this.debugInboundHistory.set(trackName, []);
                }
                const history = this.debugInboundHistory.get(trackName)!;
                history.push({
                  time: timeStr,
                  bitrate,
                  packetsReceived: pkts,
                  packetsLost: report.packetsLost || 0,
                  jitter: report.jitter || 0,
                });
                if (history.length > 60) history.shift();
              }
            });
          } catch { /* ignore */ }
        }
      } catch {
        /* ignore stats errors */
      }
    }, 2000);
  }

  stopConnectionStatsMonitoring(): void {
    if (this.connStatsInterval) {
      clearInterval(this.connStatsInterval);
      this.connStatsInterval = null;
    }
    this.connStatsCache = null;
    this.connStatsPingHistory = [];
    this.connStatsPrevBytes = null;
    this.debugHistory = [];
    this.debugInboundHistory.clear();
    this.debugPrevInbound.clear();
  }

  stopStatsMonitoring(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.remoteTrackStats.clear();
  }

  /** Returns the latest cached connection stats snapshot, or null if not yet available. */
  getConnectionStats(): VoiceConnectionStats | null {
    return this.connStatsCache;
  }

  /** Returns all debug time-series data for the full debug screen. */
  getDebugData(): {
    connectionState: string;
    participantId: string | null;
    roomSlug: string;
    transportHistory: { time: string; availableOutgoingBitrate: number; ping: number; outboundBitrate: number; inboundBitrate: number; packetsReceived: number; packetsSent: number; bytesReceived: number; bytesSent: number }[];
    inboundHistory: Record<string, { time: string; bitrate: number; packetsReceived: number; packetsLost: number; jitter: number }[]>;
    connStats: VoiceConnectionStats | null;
    pulledTracks: { track_name: string; participant_id: string; kind: string }[];
  } {
    const inbound: Record<string, any[]> = {};
    for (const [key, val] of this.debugInboundHistory.entries()) {
      inbound[key] = [...val];
    }
    return {
      connectionState: this.accessor.getConnectionState(),
      participantId: this.accessor.getParticipantId(),
      roomSlug: this.accessor.getRoomSlug(),
      transportHistory: [...this.debugHistory],
      inboundHistory: inbound,
      connStats: this.connStatsCache,
      pulledTracks: this.accessor.getPulledTracks().map(t => ({
        track_name: t.track_name,
        participant_id: t.participant_id,
        kind: t.kind,
      })),
    };
  }

  /**
   * Returns a detailed stats object matching the Discord-style JSON format.
   * Used by the "Copy Stats" button in the Voice Details panel.
   */
  async getDetailedStats(): Promise<object> {
    const connStats = this.connStatsCache;
    const outboundRtp: any[] = [];
    const inboundRtp: Record<string, any[]> = {};

    const pc = this.accessor.getPushPC();
    if (pc) {
      try {
        const stats = await pc.getStats();
        const codecMap = new Map<string, any>();

        stats.forEach((report: any) => {
          if (report.type === "codec") {
            codecMap.set(report.id, report);
          }
        });

        stats.forEach((report: any) => {
          if (report.type === "outbound-rtp") {
            const codec = report.codecId ? codecMap.get(report.codecId) : null;
            outboundRtp.push({
              type: report.kind || "audio",
              ssrc: report.ssrc,
              codec: codec ? { id: codec.payloadType, name: (codec.mimeType || "").replace(/^(audio|video)\//, "") } : null,
              bytesSent: report.bytesSent || 0,
              packetsSent: report.packetsSent || 0,
              packetsLost: 0,
              fractionLost: 0,
              bitrate: connStats?.outboundBitrate || 0,
              framesEncoded: report.framesEncoded || 0,
              sampleRate: connStats?.sampleRate || 48000,
            });
          }
        });
      } catch { /* ignore */ }
    }

    // Collect inbound from pullPC
    const pullPc = this.accessor.getPullPC();
    if (pullPc) {
      try {
        const stats = await pullPc.getStats();
        stats.forEach((report: any) => {
          if (report.type === "inbound-rtp") {
            const key = report.ssrc?.toString() || "unknown";
            if (!inboundRtp[key]) inboundRtp[key] = [];
            inboundRtp[key].push({
              type: report.kind || "audio",
              ssrc: report.ssrc,
              bytesReceived: report.bytesReceived || 0,
              packetsReceived: report.packetsReceived || 0,
              packetsLost: report.packetsLost || 0,
              jitter: report.jitter || 0,
              framesDecoded: report.framesDecoded || 0,
            });
          }
        });
      } catch { /* ignore */ }
    }

    return [[
      {
        mediaEngineConnectionId: `SFU-${this.accessor.getParticipantId() || "unknown"}`,
        transport: {
          availableOutgoingBitrate: connStats?.availableOutgoingBitrate || 0,
          ping: connStats?.ping || 0,
          localAddress: connStats?.localAddress || "(unknown)",
          packerDelay: 0,
          receiverReports: [],
          receiverBitrateEstimate: 0,
          outboundBitrateEstimate: connStats?.outboundBitrate || 0,
          inboundBitrateEstimate: connStats?.inboundBitrate || 0,
          packetsReceived: connStats?.packetsReceived || 0,
          packetsSent: connStats?.packetsSent || 0,
          bytesReceived: connStats?.bytesReceived || 0,
          bytesSent: connStats?.bytesSent || 0,
        },
        audioDevice: {
          input: {
            sessionSampleRate: connStats?.sampleRate || 48000,
          },
          output: {
            sessionSampleRate: connStats?.sampleRate || 48000,
          },
        },
        rtp: {
          inbound: inboundRtp,
          outbound: outboundRtp,
        },
        context: "default",
        index: 0,
      },
    ]];
  }

  /** Dispose all monitoring resources. */
  dispose(): void {
    this.stopStatsMonitoring();
    this.stopConnectionStatsMonitoring();
    this.uuidToClerk.clear();
  }
}
