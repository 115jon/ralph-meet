import { VoiceOpcode, type ServerMessage, type SessionDescriptionPayload, type TrackInfo } from "@/lib/types";
import { BaseGateway, type BaseGatewayEvents } from "./base-gateway";

export interface VoiceGatewayEvents extends BaseGatewayEvents {
  "voice-ready": { speaking?: Record<string, number>, tracks?: TrackInfo[], sfu_session_transferred?: boolean };
  "tracks-ready": { tracks: TrackInfo[] };
  "track-offered": { track_name: string; session_id: string; kind: 'audio' | 'video'; participant_id: string };
  "ice-candidate": { session_id: string; candidate: string; sdpMid: string; sdpMLineIndex: number };
  "session-description": SessionDescriptionPayload;
  "negotiation-done": { session_id: string };
  "speaking": { participantId: string; speaking: number };
  "stop-tracks": { track_names: string[] };
  "app-event": Record<string, unknown>;
  "error": { message: string; code?: number };
}

export class VoiceGateway extends BaseGateway<VoiceGatewayEvents> {
  private participantId: string | null = null;
  private voiceToken: string | null = null;
  private roomSlug: string | null = null;
  private wsUrlGenerator: ((path: string) => string) | null = null;

  constructor() {
    super("VoiceGW", VoiceOpcode.Heartbeat);
  }

  public connectVoice(participantId: string, voiceToken: string, roomSlug: string, wsUrlGenerator: (path: string) => string) {
    this.participantId = participantId;
    this.voiceToken = voiceToken;
    this.roomSlug = roomSlug;
    this.wsUrlGenerator = wsUrlGenerator;

    const url = wsUrlGenerator(`/api/channels/${roomSlug}/voice?v=1`);
    super.connect(url);
  }

  public updateVoiceToken(token: string) {
    this.voiceToken = token;
  }

  protected performReconnect() {
    if (this.participantId && this.voiceToken && this.roomSlug && this.wsUrlGenerator) {
      this.log.info("Voice connection lost — attempting to reconnect while preserving WebRTC peer connections");
      const url = this.wsUrlGenerator(`/api/channels/${this.roomSlug}/voice?v=1`);
      super.connect(url, false);
    }
  }

  protected handleMessage(msg: ServerMessage) {
    switch (msg.op) {
      case VoiceOpcode.Hello: {
        const hello = msg.d as any;
        this.log.info(`Hello received, interval=${hello.heartbeat_interval}ms`);
        this.heartbeat.start(hello.heartbeat_interval);

        this.send({
          op: VoiceOpcode.VoiceIdentify,
          d: {
            participant_id: this.participantId!,
            voice_token: this.voiceToken!,
          },
        }, true);
        break;
      }

      case VoiceOpcode.HeartbeatACK: {
        this.heartbeat.onAck();
        break;
      }

      case VoiceOpcode.VoiceReady: {
        this.isIdentified = true;
        this.reconnectAttempt = 0;
        this.flushQueue();

        const vr = msg.d as any;
        this.emit("voice-ready", { speaking: vr.speaking, tracks: vr.tracks });

        if (vr.speaking) {
          Object.entries(vr.speaking).forEach(([pId, speaking]) => {
            this.emit("speaking", { participantId: pId, speaking: speaking as number });
          });
        }
        break;
      }

      case VoiceOpcode.TracksReady: {
        const tr = msg.d as any;
        this.emit("tracks-ready", { tracks: tr.tracks });
        break;
      }

      case VoiceOpcode.SessionDescription: {
        const sd = msg.d as any;
        this.emit("session-description", sd);
        break;
      }

      case VoiceOpcode.NegotiationDone: {
        const nd = msg.d as any;
        this.emit("negotiation-done", { session_id: nd.session_id });
        break;
      }

      case VoiceOpcode.Video: {
        const v = msg.d as any;
        if (Array.isArray(v.tracks)) {
          for (const track of v.tracks) {
            this.emit("track-offered", {
              track_name: track.track_name,
              session_id: track.session_id,
              kind: track.kind,
              participant_id: track.participant_id || v.participant_id,
            });
          }
        }
        break;
      }

      case VoiceOpcode.Error: {
        const err = msg.d as any;
        this.emit("error", { message: err.message, code: err.code });
        break;
      }

      case VoiceOpcode.Speaking: {
        const speak = msg.d as any;
        this.emit("speaking", { participantId: speak.participant_id, speaking: speak.speaking });
        break;
      }

      case VoiceOpcode.StopTracks: {
        const st = msg.d as any;
        this.emit("stop-tracks", { track_names: st.track_names });
        break;
      }

      case VoiceOpcode.VoiceAppEvent: {
        this.emit("app-event", msg.d as Record<string, unknown>);
        break;
      }
    }
  }

  // --- External API ---

  public get isReady() {
    return this.isIdentified && this.ws?.readyState === WebSocket.OPEN;
  }

  public sendAppEvent(payload: Record<string, unknown>) {
    this.send({ op: VoiceOpcode.VoiceAppEvent, d: payload } as any);
  }
}
