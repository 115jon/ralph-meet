import { ClientMessage, PushTrackDescriptor, SessionDescriptionPayload, TrackInfo, VoiceOpcode } from '../types';
import { mungeStereoOpus } from './stereo-codec';

export interface TrackNegotiatorConfig {
  getParticipantId: () => string | null;
  sendWS: (msg: ClientMessage) => void;
  emit: (event: string, ...args: any[]) => void;
  getUnsubscribedMids: () => Set<string>;
  getUnsubscribedNames: () => Set<string>;
  pcReadyPromise: () => Promise<void>;
  waitForPushNegotiationDone: (timeoutMs?: number) => Promise<void>;
  waitForPushAnswer: (timeoutMs?: number) => Promise<void>;
}

export class TrackNegotiator {
  public pushPC: RTCPeerConnection | null = null;
  public pullPC: RTCPeerConnection | null = null;
  public pullSessionId: string | null = null;
  public pushSessionId: string | null = null;
  public pulledTracks: TrackInfo[] = [];

  private pushQueue: Promise<void> = Promise.resolve();
  private pushTransceivers = new Map<string, RTCRtpTransceiver>();
  public publishedTrackNames = new Set<string>();

  constructor(private config: TrackNegotiatorConfig) { }

  public async publishTracks(stream: MediaStream, prefix: string): Promise<void> {
    console.log(`[VoiceGW:push] publishTracks called: prefix=${prefix}, tracks=${stream.getTracks().length}, kinds=${stream.getTracks().map(t => t.kind).join(",")}, pushPC=${!!this.pushPC}`);
    this.pushQueue = this.pushQueue.then(async () => {
      console.log(`[VoiceGW:push] publishTracks queue executing: prefix=${prefix}, pushPC=${!!this.pushPC}`);

      // Wait for PeerConnection to be created (which happens after Main GW Ready)
      if (!this.pushPC) {
        console.log(`[VoiceGW:push] Waiting for pushPC to be created...`);
        await this.config.pcReadyPromise();
      }

      const pushPC = this.pushPC;
      if (!pushPC) {
        console.error("[VoiceGW:push] pushPC still null after pcReadyPromise!");
        return;
      }

      const pushTracks: PushTrackDescriptor[] = [];

      for (const track of stream.getTracks()) {
        const trackName = `${prefix}-${track.kind}-${this.config.getParticipantId()}`;

        // Optimization: Content Hints
        if (track.kind === "video") {
          track.contentHint = prefix === "screen" ? "detail" : "motion";
        } else if (track.kind === "audio") {
          track.contentHint = prefix === "screen" ? "music" : "speech";
        }

        let transceiver = this.pushTransceivers.get(trackName);

        if (transceiver) {
          console.log(`[VoiceGW:push] Reusing transceiver for ${trackName}, replacing track`);
          transceiver.sender.replaceTrack(track).catch(err => {
            console.warn(`[VoiceGW:push] replaceTrack failed for ${trackName}:`, err);
          });
        } else {
          console.log(`[VoiceGW:push] Adding new transceiver for ${trackName}`);
          const encodings: RTCRtpEncodingParameters[] = [];
          if (track.kind === "video") {
            if (prefix === "cam") {
              // Camera: Standard 3-layer simulcast
              encodings.push(
                { rid: "h", maxBitrate: 1_200_000, priority: "high" },
                { rid: "m", maxBitrate: 400_000, scaleResolutionDownBy: 2, priority: "medium" },
                { rid: "l", maxBitrate: 100_000, scaleResolutionDownBy: 4, priority: "low" }
              );
            } else {
              // Screen: SINGLE stream, NO simulcast. VP8 simulcast in Chrome
              // has a known bug that internally downscales even the highest layer.
              // Discord/Meet also disable simulcast for screen shares.
              encodings.push(
                { maxBitrate: 8_000_000, priority: "high" }
              );
            }
          } else if (track.kind === "audio") {
            if (prefix === "screen") {
              // High-fidelity screen audio (stereo)
              encodings.push({
                maxBitrate: 192_000,
                priority: "high",
                networkPriority: "high"
              } as any);
            } else {
              // High-quality speech audio (stereo)
              encodings.push({
                maxBitrate: 192_000,
                priority: "high",
                networkPriority: "high"
              } as any);
            }
          }

          transceiver = pushPC.addTransceiver(track, {
            direction: "sendonly",
            sendEncodings: encodings.length > 0 ? encodings : undefined,
          });

          // Force Opus stereo at the codec level (before SDP creation)
          // prioritizing Opus by placing it at the front of the array.
          if (track.kind === 'audio' && typeof RTCRtpSender.getCapabilities === 'function') {
            try {
              const caps = RTCRtpSender.getCapabilities('audio');
              if (caps?.codecs) {
                const opusCodecs = caps.codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
                const otherCodecs = caps.codecs.filter(c => c.mimeType.toLowerCase() !== 'audio/opus');
                transceiver.setCodecPreferences([...opusCodecs, ...otherCodecs]);
              }
            } catch (e) {
              console.warn(`[VoiceGW:push] setCodecPreferences failed for ${trackName}:`, e);
            }
          }

          // Optimization: Degradation Preference
          if (track.kind === "video") {
            const parameters = transceiver.sender.getParameters();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (parameters as any).degradationPreference = prefix === "screen" ? "maintain-resolution" : "balanced";
            transceiver.sender.setParameters(parameters).then(() => {
              console.log(`[VoiceGW:push] degradationPreference set to ${prefix === "screen" ? "maintain-resolution" : "balanced"} for ${trackName}`);
            }).catch((err) => {
              console.warn(`[VoiceGW:push] degradationPreference setParameters failed for ${trackName}:`, err);
            });
          }

          this.pushTransceivers.set(trackName, transceiver);
        }

        this.publishedTrackNames.add(trackName);
        pushTracks.push({
          track_name: trackName,
          mid: transceiver.mid || undefined,
          kind: track.kind as "audio" | "video",
        });
      }

      if (pushTracks.length === 0) return;

      console.log(`[VoiceGW:push] Publishing ${pushTracks.length} tracks`);

      const offer = await pushPC.createOffer();
      // True stereo trick
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

      const negotiationDonePromise = this.config.waitForPushNegotiationDone(10000);
      const answerPromise = this.config.waitForPushAnswer(10000);

      // Stop unhandled rejections if one fails early
      negotiationDonePromise.catch(() => { });
      answerPromise.catch(() => { });

      this.config.sendWS({
        op: VoiceOpcode.SelectProtocol,
        d: {
          sdp: pushPC.localDescription!.sdp,
          push_tracks: pushTracks,
          pull_tracks: [], // always start pull independently
        },
      });

      await answerPromise;
      await negotiationDonePromise;

      // Ensure TracksReady is fired ONLY when ICE is connected and RTP is actually flowing.
      if (pushPC.iceConnectionState !== "connected" && pushPC.iceConnectionState !== "completed") {
        await new Promise<void>((resolve) => {
          const checkIce = () => {
            if (pushPC.iceConnectionState === "connected" || pushPC.iceConnectionState === "completed") {
              pushPC.removeEventListener("iceconnectionstatechange", checkIce);
              resolve();
            }
          };
          pushPC.addEventListener("iceconnectionstatechange", checkIce);
        });
      }

      this.config.sendWS({
        op: VoiceOpcode.TracksReady,
        d: { track_names: pushTracks.map((pt) => pt.track_name) },
      });

    }).catch((err) => {
      console.error("[VoiceGW:push] publishTracks error:", err);
    });

    return this.pushQueue;
  }

  public async handleSessionDescription(sd: SessionDescriptionPayload, type: 'push' | 'pull'): Promise<void> {
    console.log(`[VoiceGW] SessionDescription: session_id=${sd.session_id}, sdp_type=${sd.sdp_type}, tracks=${sd.tracks.length}`);

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
        const mungedSDP = answer.sdp ? mungeStereoOpus(answer.sdp, "screen") : undefined;
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
      this.pushSessionId = sd.session_id;

      if (!this.pushPC) {
        console.error("[VoiceGW:push] handleSessionDescription: no push peer connection!");
        return;
      }

      try {
        const remoteSdp = sd.sdp ? mungeStereoOpus(sd.sdp) : sd.sdp;
        await this.pushPC.setRemoteDescription({ type: "answer", sdp: remoteSdp });
      } catch (err) {
        console.error("[VoiceGW:push] Failed to set remote description:", err);
        throw err;
      }
    }
  }

  public resetPullSession(): void {
    if (this.pullPC) {
      this.pullPC.ontrack = null;
      this.pullPC.onconnectionstatechange = null;
      this.pullPC.oniceconnectionstatechange = null;
      this.pullPC.onsignalingstatechange = null;
      this.pullPC.close();
      this.pullPC = null;
    }

    this.pullSessionId = null;
    this.pulledTracks = [];
  }

  public resetPushSession(): void {
    this.pushTransceivers.clear();
    this.publishedTrackNames.clear();
    this.pushSessionId = null;
    this.pushQueue = Promise.resolve();
  }

  public getTrackByMid(mid: string): TrackInfo | undefined {
    return this.pulledTracks.find((t) => t.mid === mid);
  }

  public getPushTransceiver(trackName: string): RTCRtpTransceiver | undefined {
    return this.pushTransceivers.get(trackName);
  }

  /**
   * Tears down the local transceiver for a track without sending any WS message.
   * Used by both unpublishTrack (single) and SFUClient.stopTracks (batch).
   */
  public teardownTransceiver(trackName: string) {
    this.publishedTrackNames.delete(trackName);

    if (this.pushPC) {
      const transceiver = this.pushTransceivers.get(trackName);
      if (transceiver) {
        transceiver.sender.replaceTrack(null).catch(() => { });
        if (typeof transceiver.stop === 'function') {
          try { transceiver.stop(); } catch (e) { console.warn("transceiver stop error:", e); }
        } else {
          transceiver.direction = "inactive";
        }
        this.pushTransceivers.delete(trackName);
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
}
