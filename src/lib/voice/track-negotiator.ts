import { ClientMessage, PushTrackDescriptor, SessionDescriptionPayload, TrackInfo, VoiceOpcode } from '../types';
import { mungeStereoOpus } from './stereo-codec';

const DEBUG = typeof import.meta !== "undefined" && import.meta.env?.DEV;

export interface TrackNegotiatorConfig {
  getParticipantId: () => string | null;
  sendWS: (msg: ClientMessage) => void;
  emit: (event: string, ...args: any[]) => void;
  getUnsubscribedMids: () => Set<string>;
  getUnsubscribedNames: () => Set<string>;
  pcReadyPromise: () => Promise<void>;
  waitForPushNegotiationDone: (prefix: 'cam' | 'screen', timeoutMs?: number) => Promise<void>;
  waitForPushAnswer: (prefix: 'cam' | 'screen', timeoutMs?: number) => Promise<void>;
}

/** Per-prefix push state: each prefix gets its own PC, queue, and session */
interface PushContext {
  pc: RTCPeerConnection | null;
  queue: Promise<void>;
  sessionId: string | null;
  transceivers: Map<string, RTCRtpTransceiver>;
  publishedTrackNames: Set<string>;
}

export class TrackNegotiator {
  // ── Per-prefix push PeerConnections ────────────────────────────────────
  private camPush: PushContext = this.createPushContext();
  private screenPush: PushContext = this.createPushContext();

  // ── Safely Close util ──────────────────────────────────────────────────
  private safelyClosePC(pc: RTCPeerConnection | null) {
    if (!pc) return;
    try {
      pc.getSenders().forEach((s) => {
        if (s.track) {
          s.track.onended = null;
          s.replaceTrack(null).catch(() => { });
          s.track.stop();
        }
        try { pc.removeTrack(s); } catch { }
      });
    } catch { }
    try { pc.close(); } catch { }
  }

  // ── Pull (shared, unchanged) ──────────────────────────────────────────
  public pullPC: RTCPeerConnection | null = null;
  public pullSessionId: string | null = null;
  public pulledTracks: TrackInfo[] = [];

  constructor(private config: TrackNegotiatorConfig) { }

  // ── Accessors ─────────────────────────────────────────────────────────

  private createPushContext(): PushContext {
    return {
      pc: null,
      queue: Promise.resolve(),
      sessionId: null,
      transceivers: new Map(),
      publishedTrackNames: new Set(),
    };
  }

  private getPushContext(prefix: string): PushContext {
    return prefix === 'screen' ? this.screenPush : this.camPush;
  }

  /** Public accessor for the cam push PC (used by SFUClient for connection state events) */
  get camPushPC(): RTCPeerConnection | null { return this.camPush.pc; }
  set camPushPC(pc: RTCPeerConnection | null) { this.camPush.pc = pc; }

  /** Public accessor for the screen push PC */
  get screenPushPC(): RTCPeerConnection | null { return this.screenPush.pc; }
  set screenPushPC(pc: RTCPeerConnection | null) { this.screenPush.pc = pc; }

  /** Get cam session ID */
  get camPushSessionId(): string | null { return this.camPush.sessionId; }

  /** Get screen session ID */
  get screenPushSessionId(): string | null { return this.screenPush.sessionId; }

  /** All published track names across both PCs */
  get publishedTrackNames(): Set<string> {
    return new Set([...this.camPush.publishedTrackNames, ...this.screenPush.publishedTrackNames]);
  }

  // ── Publish ───────────────────────────────────────────────────────────

  public async publishTracks(stream: MediaStream, prefix: string): Promise<void> {
    const ctx = this.getPushContext(prefix);

    if (DEBUG) console.log(`[VoiceGW:push:${prefix}] publishTracks called: tracks=${stream.getTracks().length}, kinds=${stream.getTracks().map(t => t.kind).join(",")}, pc=${!!ctx.pc}`);

    ctx.queue = ctx.queue.then(async () => {
      if (DEBUG) console.log(`[VoiceGW:push:${prefix}] publishTracks queue executing`);

      // Cam PC is created alongside pull PC during initial connect.
      // Screen PC is created lazily here when first needed.
      if (!ctx.pc) {
        if (prefix === 'cam') {
          if (DEBUG) console.log(`[VoiceGW:push:cam] Waiting for camPushPC to be created...`);
          await this.config.pcReadyPromise();
        } else {
          // Screen PC: create on demand using the same ICE config callback
          this.config.emit('create-screen-pc', undefined);
          // Wait for it to be assigned
          await new Promise<void>(resolve => {
            const check = () => {
              if (ctx.pc) return resolve();
              setTimeout(check, 50);
            };
            check();
          });
        }
      }

      const pushPC = ctx.pc;
      if (!pushPC) {
        console.error(`[VoiceGW:push:${prefix}] PC still null after creation!`);
        return;
      }

      const pushTracks: PushTrackDescriptor[] = [];

      for (const track of stream.getTracks()) {
        const trackName = `${prefix}-${track.kind}-${this.config.getParticipantId()}`;

        // Content Hints
        if (track.kind === "video") {
          track.contentHint = prefix === "screen" ? "detail" : "motion";
        } else if (track.kind === "audio") {
          track.contentHint = prefix === "screen" ? "music" : "speech";
        }

        let transceiver = ctx.transceivers.get(trackName);

        if (transceiver) {
          if (DEBUG) console.log(`[VoiceGW:push:${prefix}] Reusing transceiver for ${trackName}, replacing track`);
          transceiver.sender.replaceTrack(track).catch(err => {
            console.warn(`[VoiceGW:push:${prefix}] replaceTrack failed for ${trackName}:`, err);
          });
        } else {
          if (DEBUG) console.log(`[VoiceGW:push:${prefix}] Adding new transceiver for ${trackName}`);
          const encodings: RTCRtpEncodingParameters[] = [];
          if (track.kind === "video") {
            if (prefix === "cam") {
              encodings.push(
                { rid: "h", maxBitrate: 1_200_000, priority: "high" },
                { rid: "m", maxBitrate: 400_000, scaleResolutionDownBy: 2, priority: "medium" },
                { rid: "l", maxBitrate: 100_000, scaleResolutionDownBy: 4, priority: "low" }
              );
            } else {
              encodings.push(
                { maxBitrate: 8_000_000, priority: "high" }
              );
            }
          } else if (track.kind === "audio") {
            if (prefix === "screen") {
              encodings.push({
                maxBitrate: 192_000,
                priority: "high",
                networkPriority: "high"
              } as any);
            } else {
              encodings.push({
                maxBitrate: 128_000,
                priority: "high",
                networkPriority: "high"
              } as any);
            }
          }

          transceiver = pushPC.addTransceiver(track, {
            direction: "sendonly",
            sendEncodings: encodings.length > 0 ? encodings : undefined,
          });

          // Force Opus stereo at the codec level
          if (track.kind === 'audio' && typeof RTCRtpSender.getCapabilities === 'function') {
            try {
              const caps = RTCRtpSender.getCapabilities('audio');
              if (caps?.codecs) {
                const opusCodecs = caps.codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
                const otherCodecs = caps.codecs.filter(c => c.mimeType.toLowerCase() !== 'audio/opus');
                transceiver.setCodecPreferences([...opusCodecs, ...otherCodecs]);
              }
            } catch (e) {
              console.warn(`[VoiceGW:push:${prefix}] setCodecPreferences failed for ${trackName}:`, e);
            }
          }

          // Degradation Preference for video
          if (track.kind === "video") {
            const parameters = transceiver.sender.getParameters();
            (parameters as any).degradationPreference = prefix === "screen" ? "maintain-resolution" : "balanced";
            transceiver.sender.setParameters(parameters).then(() => {
              if (DEBUG) console.log(`[VoiceGW:push:${prefix}] degradationPreference set for ${trackName}`);
            }).catch((err) => {
              console.warn(`[VoiceGW:push:${prefix}] degradationPreference failed for ${trackName}:`, err);
            });
          }

          ctx.transceivers.set(trackName, transceiver);
        }

        ctx.publishedTrackNames.add(trackName);
        pushTracks.push({
          track_name: trackName,
          mid: transceiver.mid || undefined,
          kind: track.kind as "audio" | "video",
        });
      }

      if (pushTracks.length === 0) return;

      console.log(`[VoiceGW:push:${prefix}] Publishing ${pushTracks.length} tracks`);

      const offer = await pushPC.createOffer();
      const mungedSDP = offer.sdp ? mungeStereoOpus(offer.sdp, prefix) : undefined;
      await pushPC.setLocalDescription({ type: "offer", sdp: mungedSDP });

      // Update mids after creating offer
      for (const pt of pushTracks) {
        if (!pt.mid) {
          const transceiver = pushPC.getTransceivers().find(
            (t) => t.sender.track?.label === stream.getTracks().find(
              (st) => `${prefix}-${st.kind}-${this.config.getParticipantId()}` === pt.track_name
            )?.label
          );
          if (transceiver?.mid) {
            pt.mid = transceiver.mid;
          }
        }
      }

      const negotiationDonePromise = this.config.waitForPushNegotiationDone(prefix as 'cam' | 'screen', 10000);
      const answerPromise = this.config.waitForPushAnswer(prefix as 'cam' | 'screen', 10000);

      negotiationDonePromise.catch(() => { });
      answerPromise.catch(() => { });

      this.config.sendWS({
        op: VoiceOpcode.SelectProtocol,
        d: {
          sdp: pushPC.localDescription!.sdp,
          push_tracks: pushTracks,
          pull_tracks: [],
          push_prefix: prefix,  // Tell server which push session to use
        },
      });

      await answerPromise;
      await negotiationDonePromise;

      // TracksReady tells the server to broadcast Video to other participants.
      // Previously we waited for ICE to reach 'connected' before sending this,
      // but that added ~200-1000ms (worse on TURN paths). RTP can actually flow
      // once the SDP answer is applied — DTLS/SRTP completes before ICE fully
      // transitions. Sending TracksReady earlier lets pull clients start sooner.
      this.config.sendWS({
        op: VoiceOpcode.TracksReady,
        d: { track_names: pushTracks.map((pt) => pt.track_name) },
      });

    }).catch((err) => {
      console.error(`[VoiceGW:push:${prefix}] publishTracks error:`, err);
    });

    return ctx.queue;
  }

  // ── SDP Handling ──────────────────────────────────────────────────────

  public async handleSessionDescription(sd: SessionDescriptionPayload, type: 'push' | 'pull', prefix?: 'cam' | 'screen'): Promise<void> {
    if (DEBUG) console.log(`[VoiceGW] SessionDescription: session_id=${sd.session_id}, sdp_type=${sd.sdp_type}, tracks=${sd.tracks.length}, type=${type}, prefix=${prefix}`);

    if (type === 'pull' && sd.sdp_type === 'offer') {
      this.pullSessionId = sd.session_id;

      if (!this.pullPC) {
        console.error("[VoiceGW:pull] handleSessionDescription: no pull peer connection!");
        return;
      }

      if (sd.tracks) {
        for (const remote of sd.tracks) {
          this.pulledTracks.forEach(t => {
            if (t.mid === remote.mid && t.track_name !== remote.track_name) {
              t.mid = undefined;
            }
          });
          const local = this.pulledTracks.find(t => t.track_name === remote.track_name);
          if (local) local.mid = remote.mid;
        }
        this.pulledTracks = this.pulledTracks.filter(t => t.mid !== undefined);
      }

      try {
        const remoteSdp = sd.sdp ? mungeStereoOpus(sd.sdp) : sd.sdp;
        await this.pullPC.setRemoteDescription({ type: "offer", sdp: remoteSdp });

        this.pullPC.getTransceivers().forEach(tr => {
          const track = tr.mid ? this.getTrackByMid(tr.mid) : null;
          const isUnsubscribed = (tr.mid && this.config.getUnsubscribedMids().has(tr.mid)) ||
            (track && this.config.getUnsubscribedNames().has(track.track_name));

          if (tr.mid && isUnsubscribed) {
            tr.direction = 'inactive';
          } else if (tr.direction === 'inactive' && tr.receiver.track.kind) {
            tr.direction = 'recvonly';
          }
        });

        const answer = await this.pullPC.createAnswer();
        // Pull SDP carries both cam AND screen audio transceivers — we can't
        // prefix-differentiate here. Use default voice settings (DTX=1).
        // DTX only really matters on the push (encoder) side anyway.
        const mungedSDP = answer.sdp ? mungeStereoOpus(answer.sdp) : undefined;
        await this.pullPC.setLocalDescription({ type: "answer", sdp: mungedSDP });

        this.config.sendWS({
          op: VoiceOpcode.Answer,
          d: { sdp: this.pullPC.localDescription!.sdp },
        });
      } catch (err) {
        console.error("[VoiceGW:pull] Failed to handle SFU offer:", err);
        throw err;
      }
    } else if (type === 'push' && sd.sdp_type === 'answer') {
      // Route to the correct push context
      const ctx = prefix ? this.getPushContext(prefix) : this.routePushBySessionId(sd.session_id);

      if (!ctx) {
        console.error(`[VoiceGW:push] Cannot route push answer — no matching context for session ${sd.session_id}`);
        return;
      }

      ctx.sessionId = sd.session_id;

      if (!ctx.pc) {
        console.error(`[VoiceGW:push] handleSessionDescription: no push PC for prefix!`);
        return;
      }

      try {
        const remoteSdp = sd.sdp ? mungeStereoOpus(sd.sdp) : sd.sdp;
        if (remoteSdp && DEBUG) {
          const hasDtx = remoteSdp.includes('usedtx=1');
          const hasStereo = remoteSdp.includes('stereo=1');
          console.log(`[VoiceGW:push] Answer SDP: usedtx=${hasDtx}, stereo=${hasStereo}`);
        }
        await ctx.pc.setRemoteDescription({ type: "answer", sdp: remoteSdp });
      } catch (err) {
        console.error("[VoiceGW:push] Failed to set remote description:", err);
        throw err;
      }
    }
  }

  /**
   * Route a push SDP answer to the correct context by session_id.
   * On first answer (session_id not yet assigned), we match against the PC
   * that's in `have-local-offer` state (i.e., waiting for an answer).
   */
  private routePushBySessionId(sessionId: string): PushContext | null {
    // Check if either context already owns this session
    if (this.camPush.sessionId === sessionId) return this.camPush;
    if (this.screenPush.sessionId === sessionId) return this.screenPush;

    // New session — find which PC is waiting for an answer
    if (this.camPush.pc?.signalingState === 'have-local-offer' && !this.camPush.sessionId) {
      return this.camPush;
    }
    if (this.screenPush.pc?.signalingState === 'have-local-offer' && !this.screenPush.sessionId) {
      return this.screenPush;
    }

    // Fallback: whichever is in have-local-offer
    if (this.camPush.pc?.signalingState === 'have-local-offer') return this.camPush;
    if (this.screenPush.pc?.signalingState === 'have-local-offer') return this.screenPush;

    return null;
  }

  // ── Reset ─────────────────────────────────────────────────────────────

  public resetPullSession(): void {
    if (this.pullPC) {
      this.pullPC.ontrack = null;
      this.pullPC.onconnectionstatechange = null;
      this.pullPC.oniceconnectionstatechange = null;
      this.pullPC.onsignalingstatechange = null;
      this.safelyClosePC(this.pullPC);
      this.pullPC = null;
    }

    this.pullSessionId = null;
    this.pulledTracks = [];
  }

  public resetPushSession(prefix?: 'cam' | 'screen'): void {
    if (prefix) {
      const ctx = this.getPushContext(prefix);
      ctx.transceivers.clear();
      ctx.publishedTrackNames.clear();
      ctx.sessionId = null;
      ctx.queue = Promise.resolve();
    } else {
      // Reset both
      this.resetPushSession('cam');
      this.resetPushSession('screen');
    }
  }

  public closeScreenPushPC(): void {
    if (this.screenPush.pc) {
      this.screenPush.pc.onconnectionstatechange = null;
      this.screenPush.pc.oniceconnectionstatechange = null;
      this.screenPush.pc.onsignalingstatechange = null;
      this.safelyClosePC(this.screenPush.pc);
      this.screenPush.pc = null;
    }
    this.resetPushSession('screen');
  }

  // ── Lookups ───────────────────────────────────────────────────────────

  public getTrackByMid(mid: string): TrackInfo | undefined {
    return this.pulledTracks.find((t) => t.mid === mid);
  }

  public getPushTransceiver(trackName: string): RTCRtpTransceiver | undefined {
    return this.camPush.transceivers.get(trackName)
      || this.screenPush.transceivers.get(trackName);
  }

  /**
   * Tears down the local transceiver for a track without sending any WS message.
   */
  public teardownTransceiver(trackName: string) {
    // Determine which context owns this track
    const ctx = trackName.startsWith('screen-') ? this.screenPush : this.camPush;
    ctx.publishedTrackNames.delete(trackName);

    if (ctx.pc) {
      const transceiver = ctx.transceivers.get(trackName);
      if (transceiver) {
        transceiver.sender.replaceTrack(null).catch(() => { });
        if (typeof transceiver.stop === 'function') {
          try { transceiver.stop(); } catch (e) { console.warn("transceiver stop error:", e); }
        } else {
          transceiver.direction = "inactive";
        }
        ctx.transceivers.delete(trackName);
      }
    }
  }

  public unpublishTrack(trackName: string) {
    console.log(`[VoiceGW] Unpublishing track: ${trackName}`);
    this.teardownTransceiver(trackName);

    this.config.sendWS({
      op: VoiceOpcode.StopTracks,
      d: { track_names: [trackName] },
    });
  }

  /**
   * Determine which push prefix a session_id belongs to.
   * Returns 'cam', 'screen', or null.
   */
  public getPrefixBySessionId(sessionId: string): 'cam' | 'screen' | null {
    if (this.camPush.sessionId === sessionId) return 'cam';
    if (this.screenPush.sessionId === sessionId) return 'screen';
    // On first answer, match by signaling state
    if (this.camPush.pc?.signalingState === 'have-local-offer' && !this.camPush.sessionId) return 'cam';
    if (this.screenPush.pc?.signalingState === 'have-local-offer' && !this.screenPush.sessionId) return 'screen';
    return null;
  }
}
