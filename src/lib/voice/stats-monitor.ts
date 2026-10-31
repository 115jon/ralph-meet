// ============================================================================
// ConnectionStatsMonitor — WebRTC stats digest, debug time-series, detailed stats
// ============================================================================
//
// Design: the monitor owns no timer. The SFU client's StatsHub takes one
// getStats() snapshot per tick (2 s, 1 s while a stall is suspected) and
// hands it to ingestTrackStats() and ingestConnectionStats(). Each ingest
// updates the caches and pushes to registered listeners, so consumers get an
// instant push instead of polling on their own timer. A new listener receives
// the cached snapshot synchronously, which avoids a "Connecting…" flash.

import { clog } from "../console-logger";
import type { VoiceConnectionStats } from "../sfu-client";
import type { ConnectionSample, TrackInfo } from "../types";

/** Samples kept for the stats charts: 2 minutes at the 2 s tick. */
export const CONNECTION_SAMPLE_CAPACITY = 60;

const statsLog = clog("VoiceStats");

/** Accessor interface for reading SFUClient state without circular dependency */
export interface StatsAccessor {
  getPushPC(): RTCPeerConnection | null;
  getPullPC(): RTCPeerConnection | null;
  getPulledTracks(): TrackInfo[];
  getRoomSlug(): string;
  getParticipantId(): string | null;
  getConnectionState(): string;
  getPublishConnectionState(): string;
  getSubscribeConnectionState(): string;
}

export class ConnectionStatsMonitor {
  // -- Track-level stats --
  private remoteTrackStats = new Map<
    string,
    {
      fps: number;
      bitrate: number;
      width: number;
      height: number;
      timestamp: number;
      frames: number;
      bytes: number;
    }
  >();

  // -- Connection stats for Voice Details panel --
  private connStatsCache: VoiceConnectionStats | null = null;
  private connStatsPingHistory: { time: string; ping: number }[] = [];
  private connStatsPrevBytes: {
    sent: number;
    received: number;
    timestamp: number;
  } | null = null;
  // Bounded ring for the charts; the snapshot carries a copy.
  private connStatsSamples: ConnectionSample[] = [];
  // Audio counters at the previous tick, for per-interval loss.
  private connStatsPrevLoss: { sent: number; lost: number } | null = null;

  // -- Push-style listeners: notified on every tick instead of polling --
  private connStatsListeners = new Set<(stats: VoiceConnectionStats) => void>();
  // -- Per-track stats listeners (QualityMonitor labels) --
  private trackStatsListeners = new Set<() => void>();

  // -- Debug time-series (full debug screen) --
  private debugHistory: {
    time: string;
    /** Epoch ms of the tick. */
    timestamp: number;
    availableOutgoingBitrate: number;
    ping: number;
    outboundBitrate: number;
    inboundBitrate: number;
    packetsReceived: number;
    packetsSent: number;
    bytesReceived: number;
    bytesSent: number;
  }[] = [];
  private debugInboundHistory: Map<
    string,
    {
      time: string;
      timestamp: number;
      bitrate: number;
      packetsReceived: number;
      packetsLost: number;
      jitter: number;
    }[]
  > = new Map();
  private debugPrevInbound: Map<
    string,
    {
      bytes: number;
      packets: number;
      timestamp: number;
    }
  > = new Map();

  // -- UUID → user ID mapping for getStatsByUserId --
  private uuidToUserId = new Map<string, string>();

  private readonly accessor: StatsAccessor;

  constructor(accessor: StatsAccessor) {
    this.accessor = accessor;
  }

  /** Set a mapping from participant UUID to user ID */
  setUserMapping(uuid: string, userId: string): void {
    this.uuidToUserId.set(uuid, userId);
  }

  /** Remove a participant's user mapping */
  deleteUserMapping(uuid: string): void {
    this.uuidToUserId.delete(uuid);
  }

  /**
   * Called after every track-stats ingest. Readers then call
   * getStatsByUserId(); returns an unsubscribe function.
   */
  subscribeTrackStats(cb: () => void): () => void {
    this.trackStatsListeners.add(cb);
    return () => {
      this.trackStatsListeners.delete(cb);
    };
  }

  private notifyTrackStatsListeners(): void {
    for (const cb of Array.from(this.trackStatsListeners)) {
      try {
        cb();
      } catch {
        /* ignore listener errors */
      }
    }
  }

  getTrackStats(trackName: string) {
    return this.remoteTrackStats.get(trackName);
  }

  getStatsByUserId(userId: string, trackPrefix: "cam" | "screen") {
    let uuid: string | null = null;
    for (const [u, c] of Array.from(this.uuidToUserId.entries())) {
      if (c === userId) {
        uuid = u;
        break;
      }
    }
    if (!uuid) return null;
    return this.getTrackStats(`${trackPrefix}-video-${uuid}`);
  }

  /**
   * Per-track video stats (fps, bitrate, resolution) from one shared stats
   * snapshot. Fed by the StatsHub; the monitor owns no timer of its own.
   */
  ingestTrackStats(stats: RTCStatsReport, now: number = Date.now()): void {
    {
      try {
        const pulledTracks = this.accessor.getPulledTracks();

        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            // Chrome: trackIdentifier, Firefox fallback: mid
            const trackId = (report as any).trackIdentifier;
            let trackInfo = trackId
              ? pulledTracks.find((t) => t.track?.id === trackId)
              : undefined;
            if (!trackInfo && (report as any).mid != null) {
              trackInfo = pulledTracks.find(
                (t) => t.mid === (report as any).mid,
              );
            }
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
                this.remoteTrackStats.set(trackInfo.track_name, {
                  fps,
                  bitrate,
                  width,
                  height,
                  timestamp: now,
                  frames,
                  bytes,
                });
              }
            } else {
              this.remoteTrackStats.set(trackInfo.track_name, {
                fps: 0,
                bitrate: 0,
                width,
                height,
                timestamp: now,
                frames,
                bytes,
              });
            }
          }
        });
      } catch {
        /* ignore */
      }
    }
    this.notifyTrackStatsListeners();
  }

  /**
   * Begin a connection-stats session for a new peer connection.
   *
   * We intentionally preserve `connStatsCache` so the UI continues to show
   * the last known latency rather than flashing "Connecting…" while the
   * first snapshot of the new session is in flight. Full teardown (including
   * cache clear) only happens in stopConnectionStatsMonitoring()/dispose().
   */
  beginConnectionStatsSession(): void {
    // Reset per-session accumulators but keep the cache alive.
    this.connStatsPingHistory = [];
    this.connStatsPrevBytes = null;
    this.connStatsSamples = [];
    this.connStatsPrevLoss = null;
  }

  /**
   * Build the Voice Details snapshot from one shared stats report and push
   * it to every listener. PartyTracks uses a single peer connection, so the
   * same report serves as both the "push" (outbound) and "pull" (inbound)
   * view; every counter below is merged with Math.max, so that is safe.
   */
  ingestConnectionStats(
    stats: RTCStatsReport,
    pc: RTCPeerConnection | null,
    now: number = Date.now(),
  ): void {
    const pushPC = pc;
    const pushStats: RTCStatsReport | null = stats;
    const pullStats: RTCStatsReport | null = stats;
    {
      try {
        let mediaRtt = 0;
        let localAddress = "";
        let remoteAddress = "";
        let packetsSent = 0;
        let packetsReceived = 0;
        let bytesSent = 0;
        let bytesReceived = 0;
        let availableOutgoingBitrate = 0;

        let codecName = "";
        let codecId = 0;
        const audioLevel = 0;
        let sampleRate = 48000;
        let framesEncoded = 0;
        let packetsLost = 0;

        // ── Cross-browser active candidate-pair finder ───────────────────
        //
        // Chrome:  candidate-pair has { state: "succeeded", nominated: true }
        // Firefox: candidate-pair may have { selected: true } instead,
        //          or the transport report has selectedCandidatePairId.
        // Spec:    transport.selectedCandidatePairId is the canonical way.
        const findActivePairId = (s: RTCStatsReport): string | null => {
          let selectedId: string | null = null;
          // 1) Standard: transport.selectedCandidatePairId
          s.forEach((report: any) => {
            if (report.type === "transport" && report.selectedCandidatePairId) {
              selectedId = report.selectedCandidatePairId;
            }
          });
          if (selectedId) return selectedId;
          // 2) Chrome: succeeded + nominated
          s.forEach((report: any) => {
            if (
              report.type === "candidate-pair" &&
              report.state === "succeeded" &&
              report.nominated
            ) {
              selectedId = report.id;
            }
          });
          if (selectedId) return selectedId;
          // 3) Firefox non-standard: selected boolean
          s.forEach((report: any) => {
            if (
              report.type === "candidate-pair" &&
              (report as any).selected === true
            ) {
              selectedId = report.id;
            }
          });
          return selectedId;
        };

        // Find the active candidate pair from whichever PC has one
        let iceStats: RTCStatsReport | null = null;
        if (pushStats && findActivePairId(pushStats)) {
          iceStats = pushStats;
        } else if (pullStats && findActivePairId(pullStats)) {
          iceStats = pullStats;
        }

        // ── ICE-level stats (ping, addresses) from active pair ──────────
        if (iceStats) {
          const activePairId = findActivePairId(iceStats)!;
          const activePair: any = iceStats.get(activePairId);
          if (activePair) {
            availableOutgoingBitrate = activePair.availableOutgoingBitrate || 0;

            // Transport counters from candidate-pair
            bytesSent = Math.max(bytesSent, activePair.bytesSent || 0);
            bytesReceived = Math.max(
              bytesReceived,
              activePair.bytesReceived || 0,
            );
            packetsSent = Math.max(packetsSent, activePair.packetsSent || 0);
            packetsReceived = Math.max(
              packetsReceived,
              activePair.packetsReceived || 0,
            );

            // Resolve local/remote candidate addresses.
            // Prefer host candidates over relay/srflx for the "local" label
            // since relay addresses show the TURN server IP, not the user's.
            const localCand = activePair.localCandidateId;
            const remoteCand = activePair.remoteCandidateId;
            if (localCand) {
              const lc = iceStats.get(localCand) as any;
              if (lc) {
                const addr = lc.address || lc.ip || "?";
                const port = lc.port || "?";
                const ctype = lc.candidateType || "";
                localAddress =
                  ctype && ctype !== "host"
                    ? `${addr}:${port} (${ctype})`
                    : `${addr}:${port}`;
              }
            }
            if (remoteCand) {
              const rc = iceStats.get(remoteCand) as any;
              if (rc) {
                const addr = rc.address || rc.ip || "?";
                const port = rc.port || "?";
                const ctype = rc.candidateType || "";
                remoteAddress =
                  ctype && ctype !== "host"
                    ? `${addr}:${port} (${ctype})`
                    : `${addr}:${port}`;
              }
            }
          }

          // Also read transport-level bytes if available
          iceStats.forEach((report: any) => {
            if (report.type === "transport") {
              bytesSent = Math.max(bytesSent, report.bytesSent || 0);
              bytesReceived = Math.max(
                bytesReceived,
                report.bytesReceived || 0,
              );
              packetsSent = Math.max(packetsSent, report.packetsSent || 0);
              packetsReceived = Math.max(
                packetsReceived,
                report.packetsReceived || 0,
              );
            }
          });
        }

        // ── Outbound stats from pushPC ──────────────────────────────────
        // Codec info, framesEncoded, and the RTCP-based RTT come from here.
        let rtpBytesSent = 0;
        let rtpPacketsSent = 0;
        let audioPacketsSent = 0;
        let jitterMs = 0;
        let fractionLost: number | null = null;
        const remoteInboundRtts: number[] = [];

        if (pushStats) {
          // Collect codec map from push stats
          const pushCodecMap = new Map<
            string,
            { mimeType: string; payloadType: number }
          >();
          pushStats.forEach((report: any) => {
            if (report.type === "codec") {
              pushCodecMap.set(report.id, {
                mimeType: report.mimeType || "",
                payloadType: report.payloadType || 0,
              });
            }
          });

          pushStats.forEach((report: any) => {
            if (report.type === "outbound-rtp") {
              rtpBytesSent += report.bytesSent || 0;
              rtpPacketsSent += report.packetsSent || 0;

              if (report.kind === "audio") {
                audioPacketsSent += report.packetsSent || 0;
                framesEncoded = report.framesEncoded || 0;
                if (report.codecId && pushCodecMap.has(report.codecId)) {
                  const c = pushCodecMap.get(report.codecId)!;
                  codecName = c.mimeType.replace("audio/", "");
                  codecId = c.payloadType;
                }
              }
            }

            // remote-inbound-rtp: RTCP receiver report from the SFU.
            // roundTripTime here measures actual RTCP SR→RR round-trip,
            // which is the TRUE media-path latency — unlike ICE's
            // currentRoundTripTime which measures STUN binding requests
            // (inflated on forced-TURN paths like Cloudflare Calls).
            if (report.type === "remote-inbound-rtp") {
              if (report.kind === "audio") {
                packetsLost = report.packetsLost || 0;
                // The SFU's view of our audio: jitter in seconds, and the
                // loss fraction of the interval its last report covered.
                jitterMs = Math.max(jitterMs, (report.jitter || 0) * 1000);
                if (typeof report.fractionLost === "number") {
                  fractionLost = report.fractionLost;
                }
              }
              if (report.roundTripTime != null && report.roundTripTime > 0) {
                remoteInboundRtts.push(report.roundTripTime * 1000);
              } else if (
                report.totalRoundTripTime != null &&
                report.roundTripTimeMeasurements > 0
              ) {
                remoteInboundRtts.push(
                  (report.totalRoundTripTime /
                    report.roundTripTimeMeasurements) *
                    1000,
                );
              }
            }
          });
        }

        // ── Inbound stats from pullPC ───────────────────────────────────
        let rtpBytesReceived = 0;
        let rtpPacketsReceived = 0;

        if (pullStats) {
          pullStats.forEach((report: any) => {
            if (report.type === "inbound-rtp") {
              rtpBytesReceived += report.bytesReceived || 0;
              rtpPacketsReceived += report.packetsReceived || 0;
            }

            // Also check pull PC's transport for byte counters
            if (report.type === "transport") {
              bytesReceived = Math.max(
                bytesReceived,
                report.bytesReceived || 0,
              );
              packetsReceived = Math.max(
                packetsReceived,
                report.packetsReceived || 0,
              );
            }

            // Pull PC's candidate-pair may also have useful counters
            if (
              report.type === "candidate-pair" &&
              ((report as any).selected === true ||
                (report.state === "succeeded" && report.nominated))
            ) {
              bytesReceived = Math.max(
                bytesReceived,
                report.bytesReceived || 0,
              );
              packetsReceived = Math.max(
                packetsReceived,
                report.packetsReceived || 0,
              );
            }
          });
        }

        // ── Merge: prefer RTP aggregates when ICE-level counters are missing
        if (bytesSent === 0 && rtpBytesSent > 0) bytesSent = rtpBytesSent;
        if (bytesReceived === 0 && rtpBytesReceived > 0)
          bytesReceived = rtpBytesReceived;
        if (packetsSent === 0 && rtpPacketsSent > 0)
          packetsSent = rtpPacketsSent;
        if (packetsReceived === 0 && rtpPacketsReceived > 0)
          packetsReceived = rtpPacketsReceived;

        // ── RTT selection (most important fix) ──────────────────────────
        // PREFER remote-inbound-rtp.roundTripTime (RTCP SR->RR based):
        //   - Measures media-path RTT for outbound RTP streams
        //   - Avoids showing ICE/STUN connectivity-check RTT as voice ping
        //   - Leaves ping at 0 until a receiver report is available
        if (remoteInboundRtts.length > 0) {
          mediaRtt = Math.round(
            remoteInboundRtts.reduce((sum, value) => sum + value, 0) /
              remoteInboundRtts.length,
          );
        }

        const ping = mediaRtt;

        // Update ping history (keep last 30 samples = ~60s at 2s interval).
        // Skip zero readings — they come from ticks that fired before ICE
        // established (currentRoundTripTime is 0 until a candidate pair is
        // nominated), and would skew the average ping downward.
        const timeStr = new Date(now).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        if (ping > 0) {
          this.connStatsPingHistory.push({ time: timeStr, ping });
          if (this.connStatsPingHistory.length > 30) {
            this.connStatsPingHistory.shift();
          }
        }

        // Calculate average ping from history
        const avgPing =
          this.connStatsPingHistory.length > 0
            ? Math.round(
                this.connStatsPingHistory.reduce((sum, p) => sum + p.ping, 0) /
                  this.connStatsPingHistory.length,
              )
            : ping;

        // Calculate bitrate deltas
        let outboundBitrate = 0;
        let inboundBitrate = 0;
        if (this.connStatsPrevBytes) {
          const dt = (now - this.connStatsPrevBytes.timestamp) / 1000;
          if (dt > 0.5) {
            outboundBitrate = Math.max(
              0,
              ((bytesSent - this.connStatsPrevBytes.sent) * 8) / dt,
            );
            inboundBitrate = Math.max(
              0,
              ((bytesReceived - this.connStatsPrevBytes.received) * 8) / dt,
            );
          }
        }
        this.connStatsPrevBytes = {
          sent: bytesSent,
          received: bytesReceived,
          timestamp: now,
        };

        // Calculate packet loss rate
        const totalPackets = packetsSent + packetsLost;
        const packetLossRate =
          totalPackets > 0 ? packetsLost / totalPackets : 0;

        // Loss over this interval only: the receiver report's fraction when
        // the browser exposes it, else the audio counter deltas.
        let intervalLoss = 0;
        if (fractionLost !== null) {
          intervalLoss = fractionLost;
        } else if (this.connStatsPrevLoss) {
          const lost = packetsLost - this.connStatsPrevLoss.lost;
          const sent = audioPacketsSent - this.connStatsPrevLoss.sent;
          if (lost > 0 && sent > 0) intervalLoss = lost / (sent + lost);
        }
        this.connStatsPrevLoss = { sent: audioPacketsSent, lost: packetsLost };
        const jitter = Math.round(jitterMs * 10) / 10;
        this.connStatsSamples.push({
          t: now,
          bitrate: Math.round(outboundBitrate / 100) / 10,
          loss: Math.round(Math.min(1, Math.max(0, intervalLoss)) * 1000) / 10,
          jitter,
          rtt: ping,
        });
        if (this.connStatsSamples.length > CONNECTION_SAMPLE_CAPACITY) {
          this.connStatsSamples.shift();
        }

        // Try to get audio level from local audio track settings
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
        const remoteTrackCount = this.accessor.getPulledTracks().length;

        const snapshot: VoiceConnectionStats = {
          ping,
          avgPing,
          pingHistory: [...this.connStatsPingHistory],
          jitter,
          samples: [...this.connStatsSamples],
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
          connectionState: this.accessor.getConnectionState(),
          publishConnectionState: this.accessor.getPublishConnectionState(),
          subscribeConnectionState: this.accessor.getSubscribeConnectionState(),
          remoteTrackCount,
        };

        // -- Debug series; a failure here must not cost the push below --
        try {
          // -- Debug time-series: append transport-level history --
          this.debugHistory.push({
            time: timeStr,
            timestamp: now,
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

          // -- Debug: collect per-track inbound stats from the same report --
          const debugPullStats = pullStats;
          if (debugPullStats) {
            const pullNow = Date.now();
            const pulledTracks = this.accessor.getPulledTracks();
            debugPullStats.forEach((report: any) => {
              if (report.type === "inbound-rtp") {
                // Chrome uses trackIdentifier, Firefox uses track.id via receiver
                // or may have mid-based identification. Try both.
                const trackId = report.trackIdentifier;
                let trackInfo = trackId
                  ? pulledTracks.find((t) => t.track?.id === trackId)
                  : undefined;

                // Firefox fallback: match by mid if trackIdentifier is absent
                if (!trackInfo && report.mid != null) {
                  trackInfo = pulledTracks.find((t) => t.mid === report.mid);
                }

                const trackName =
                  trackInfo?.track_name || `ssrc-${report.ssrc}`;
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
                this.debugPrevInbound.set(trackName, {
                  bytes,
                  packets: pkts,
                  timestamp: pullNow,
                });

                if (!this.debugInboundHistory.has(trackName)) {
                  this.debugInboundHistory.set(trackName, []);
                }
                const history = this.debugInboundHistory.get(trackName)!;
                history.push({
                  time: timeStr,
                  timestamp: now,
                  bitrate,
                  packetsReceived: pkts,
                  packetsLost: report.packetsLost || 0,
                  jitter: report.jitter || 0,
                });
                if (history.length > 60) history.shift();
              }
            });
          }
        } catch {
          /* ignore debug-series errors */
        }

        // Update the cache and push to all listeners in one atomic step,
        // after the debug series so a listener that reads getDebugData()
        // sees this tick too.
        const isFirstSnapshot = this.connStatsCache === null;
        this.connStatsCache = snapshot;
        if (isFirstSnapshot) {
          statsLog.info(
            `First snapshot ready — ping=${ping}ms, listeners=${this.connStatsListeners.size}`,
          );
        }
        for (const cb of this.connStatsListeners) {
          try {
            cb(snapshot);
          } catch {
            /* ignore listener errors */
          }
        }
      } catch {
        /* ignore stats errors */
      }
    }
  }

  /**
   * Subscribe to connection stats updates. The callback is invoked on every
   * successful tick (approximately every 2s). Returns an unsubscribe function.
   *
   * If a snapshot is already cached it is delivered synchronously to the new
   * listener so the first render doesn't have to wait.
   */
  subscribeConnectionStats(
    cb: (stats: VoiceConnectionStats) => void,
  ): () => void {
    this.connStatsListeners.add(cb);
    // Deliver the current snapshot immediately if available.
    if (this.connStatsCache) {
      statsLog.info(
        `Subscriber added — delivering cached snapshot (ping=${this.connStatsCache.ping}ms)`,
      );
      cb(this.connStatsCache);
    } else {
      statsLog.info(
        `Subscriber added — no snapshot yet, will push on next tick`,
      );
    }
    return () => {
      this.connStatsListeners.delete(cb);
    };
  }

  stopConnectionStatsMonitoring(): void {
    this.connStatsCache = null;
    this.connStatsPingHistory = [];
    this.connStatsPrevBytes = null;
    this.connStatsSamples = [];
    this.connStatsPrevLoss = null;
    this.debugHistory = [];
    this.debugInboundHistory.clear();
    this.debugPrevInbound.clear();
  }

  stopStatsMonitoring(): void {
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
    transportHistory: {
      time: string;
      /** Epoch ms of the tick. */
      timestamp: number;
      availableOutgoingBitrate: number;
      ping: number;
      outboundBitrate: number;
      inboundBitrate: number;
      packetsReceived: number;
      packetsSent: number;
      bytesReceived: number;
      bytesSent: number;
    }[];
    inboundHistory: Record<
      string,
      {
        time: string;
        timestamp: number;
        bitrate: number;
        packetsReceived: number;
        packetsLost: number;
        jitter: number;
      }[]
    >;
    connStats: VoiceConnectionStats | null;
    pulledTracks: {
      track_name: string;
      participant_id: string;
      kind: string;
    }[];
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
      pulledTracks: this.accessor.getPulledTracks().map((t) => ({
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
              codec: codec
                ? {
                    id: codec.payloadType,
                    name: (codec.mimeType || "").replace(
                      /^(audio|video)\//,
                      "",
                    ),
                  }
                : null,
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
      } catch {
        /* ignore */
      }
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
      } catch {
        /* ignore */
      }
    }

    return [
      [
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
      ],
    ];
  }

  /** Dispose all monitoring resources. */
  dispose(): void {
    this.stopStatsMonitoring();
    this.stopConnectionStatsMonitoring();
    this.connStatsListeners.clear();
    this.trackStatsListeners.clear();
    this.uuidToUserId.clear();
  }
}
