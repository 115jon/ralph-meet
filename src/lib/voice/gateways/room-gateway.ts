import { VoiceOpcode, type IceServer, type ServerMessage, type TrackInfo, type VoiceState } from "@/lib/types";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { BaseGateway, type BaseGatewayEvents } from "./base-gateway";

export interface RoomGatewayEvents extends BaseGatewayEvents {
  "ready": {
    participantId: string;
    sessionId: string;
    iceServers: IceServer[];
    voiceToken: string;
    tracksToQueue: TrackInfo[];
    participants: VoiceState[];
    spatialAudioState?: SharedSpatialAudioState;
  };
  "resumed": { voiceToken?: string; iceServers?: IceServer[]; participants?: VoiceState[]; spatialAudioState?: SharedSpatialAudioState };
  "participant-joined": { participant: any };
  "participant-left": { participantId: string };
  "voice-state-update": { participant: any; action: string; spatialAudioState?: SharedSpatialAudioState };
  "speaking": { participantId: string; speaking: number };
  "profile-update": { participantId: string; name: string; username?: string; displayName?: string | null; avatarUrl?: string };
  "error": { message: string, code?: number };
}

export interface ConnectOptions {
  name: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string;
  clerkUserId?: string;
  roomSlug: string;
  wsUrlGenerator: (path: string) => string;
}

export class RoomGateway extends BaseGateway<RoomGatewayEvents> {
  private sessionId: string | null = null;
  private participantId: string | null = null;
  private lastSeqAck = -1;
  private options: ConnectOptions | null = null;

  constructor() {
    super("RoomGW", VoiceOpcode.Heartbeat);
  }

  public connectRoom(options: ConnectOptions) {
    this.options = options;
    const url = options.wsUrlGenerator(`/api/channels/${options.roomSlug}/ws?v=1`);
    super.connect(url);
  }

  public disconnect() {
    this.sessionId = null;
    this.participantId = null;
    this.lastSeqAck = -1;
    super.disconnect();
  }

  protected performReconnect() {
    if (this.options) {
      this.log.info("Attempting reconnect...");
      this.isIdentified = false;
      const url = this.options.wsUrlGenerator(`/api/channels/${this.options.roomSlug}/ws?v=1`);
      super.connect(url, false);
    }
  }

  protected handleMessage(msg: ServerMessage) {
    switch (msg.op) {
      case VoiceOpcode.Hello: {
        const hello = msg.d as any;
        this.log.info(`Hello received, interval=${hello.heartbeat_interval}ms`);
        this.heartbeat.start(hello.heartbeat_interval);

        if (this.sessionId && this.participantId) {
          this.log.info(`Attempting resume for session ${this.participantId}`);
          this.send({
            op: VoiceOpcode.Resume,
            d: { session_id: this.participantId, seq_ack: this.lastSeqAck },
          }, true);
        } else {
          this.send({
            op: VoiceOpcode.Identify,
            d: {
              name: this.options?.name || "Guest",
              username: this.options?.username,
              display_name: this.options?.displayName,
              avatar_url: this.options?.avatarUrl,
              clerk_user_id: this.options?.clerkUserId,
            },
          }, true);
        }
        break;
      }

      case VoiceOpcode.Ready: {
        const ready = msg.d as any;
        this.participantId = ready.participant_id;
        this.sessionId = ready.participant_id;

        const tracksToQueue: TrackInfo[] = [];
        for (const p of ready.participants || []) {
          for (const t of p.tracks || []) {
            tracksToQueue.push(t);
          }
        }

        this.isIdentified = true;
        this.reconnectAttempt = 0;
        this.flushQueue();

        this.emit("ready", {
          participantId: ready.participant_id,
          sessionId: ready.participant_id,
          iceServers: ready.ice_servers,
          voiceToken: ready.voice_token,
          tracksToQueue,
          participants: ready.participants || [],
          spatialAudioState: ready.spatial_audio_state,
        });
        break;
      }

      case VoiceOpcode.Resumed: {
        this.log.info("Session resumed successfully");
        const resumed = msg.d as any;

        this.isIdentified = true;
        this.reconnectAttempt = 0;
        this.flushQueue();

        this.emit("resumed", {
          voiceToken: resumed.voice_token,
          iceServers: resumed.ice_servers,
          participants: resumed.participants || [],
          spatialAudioState: resumed.spatial_audio_state,
        });
        break;
      }

      case VoiceOpcode.HeartbeatACK: {
        this.heartbeat.onAck();
        const ack = msg.d as any;
        if (ack?.seq != null) {
          this.lastSeqAck = ack.seq;
        }
        break;
      }

      case VoiceOpcode.VoiceStateUpdate: {
        const vsu = msg.d as any;
        this.emit("voice-state-update", { participant: vsu.participant, action: vsu.action, spatialAudioState: vsu.spatial_audio_state });
        if (vsu.action === "join") this.emit("participant-joined", { participant: vsu.participant });
        else if (vsu.action === "leave") this.emit("participant-left", { participantId: vsu.participant.id });
        break;
      }

      case VoiceOpcode.ProfileUpdate: {
        const pu = msg.d as any;
        this.emit("profile-update", {
          participantId: pu.participant_id,
          name: pu.name,
          username: pu.username,
          displayName: pu.display_name,
          avatarUrl: pu.avatar_url,
        });
        break;
      }

      case VoiceOpcode.Error: {
        const err = msg.d as any;
        this.log.error(`Error (code=${err.code}):`, err.message);

        if (err.code === 4006) {
          this.log.warn("Resume failed — falling back to fresh Identify");
          this.sessionId = null;
          this.participantId = null;
          this.lastSeqAck = -1;
          this.send({
            op: VoiceOpcode.Identify,
            d: {
              name: this.options?.name || "Guest",
              username: this.options?.username,
              display_name: this.options?.displayName,
              avatar_url: this.options?.avatarUrl,
              clerk_user_id: this.options?.clerkUserId,
            },
          }, true);
          break;
        }

        this.emit("error", { message: err.message, code: err.code });
        break;
      }
    }
  }

  // --- External API for sending specific messages ---

  public sendMuteUpdate(isMicOn: boolean, isCameraOn: boolean) {
    this.send({
      op: VoiceOpcode.VoiceStateUpdate,
      d: { self_mute: !isMicOn, self_video: isCameraOn },
    });
  }

  public sendVoiceState(state: any) {
    this.send({
      op: VoiceOpcode.VoiceStateUpdate,
      d: state,
    });
  }

  public requestCredentialRefresh() {
    this.send({
      op: VoiceOpcode.RefreshVoiceCredentials,
      d: {},
    });
  }

  public get isReady() {
    return this.isIdentified && this.ws?.readyState === WebSocket.OPEN;
  }
}
