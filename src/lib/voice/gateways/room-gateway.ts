import {
  decodeRoomGatewayServerFrame,
  GatewayCloseCode,
  readReplaySeq,
  type GatewayFrame,
  type RoomGatewayServerMessage,
} from "@/lib/gateway-protocol";
import {
  VoiceOpcode,
  type IceServer,
  type TrackInfo,
  type VoiceState,
  type VoiceStateDelta,
} from "@/lib/types";
import {
  fetchSocketTicketBundle,
  type MediaBootstrap,
} from "@/lib/voice/socket-ticket-client";
import { markVoice } from "@/lib/voice/latency-marks";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { BaseGateway, type BaseGatewayEvents } from "./base-gateway";

export interface RoomGatewayEvents extends BaseGatewayEvents {
  "media-bootstrap": MediaBootstrap;
  "media-ready": {
    participantId: string;
    iceServers: IceServer[];
    voiceToken: string;
  };
  ready: {
    participantId: string;
    sessionId: string;
    iceServers: IceServer[];
    voiceToken: string;
    tracksToQueue: TrackInfo[];
    participants: VoiceState[];
    spatialAudioState?: SharedSpatialAudioState;
  };
  resumed: {
    voiceToken?: string;
    iceServers?: IceServer[];
    participants?: VoiceState[];
    spatialAudioState?: SharedSpatialAudioState;
  };
  "participant-joined": { participant: VoiceState };
  "participant-left": { participantId: string };
  "voice-state-update": {
    participant: VoiceState | VoiceStateDelta;
    action: "join" | "leave" | "update";
    spatialAudioState?: SharedSpatialAudioState;
  };
  speaking: { participantId: string; speaking: number };
  "profile-update": {
    participantId: string;
    name: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    avatarDisplay?:
      | import("@/lib/avatar-display").AvatarDisplay
      | string
      | null;
  };
  error: { message: string; code?: number };
}

export interface ConnectOptions {
  name: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string;
  avatarDisplay?: import("@/lib/avatar-display").AvatarDisplay | string | null;
  clerkUserId?: string;
  channelId?: string;
  serverId?: string;
  roomSlug: string;
  wsUrlGenerator: (path: string) => string;
  standby?: boolean;
}

interface RoomSocketTicket {
  readonly url: string;
  readonly protocols: string[];
  readonly mediaBootstrap?: MediaBootstrap;
  readonly roomSlug: string;
}

export class RoomGateway extends BaseGateway<
  RoomGatewayEvents,
  RoomGatewayServerMessage,
  RoomSocketTicket
> {
  private sessionId: string | null = null;
  private participantId: string | null = null;
  private lastReplayableSeq = 0;
  private options: ConnectOptions | null = null;

  constructor() {
    super("RoomGW", decodeRoomGatewayServerFrame);
  }

  public connectRoom(options: ConnectOptions) {
    this.options = options;
    // A ticket already in flight was requested for the previous options.
    this.socket.connect({ freshTicket: true });
  }

  protected async acquireTicket(): Promise<RoomSocketTicket> {
    const options = this.options;
    if (!options) throw new Error("Room socket has no room to connect to");
    const audience = options.roomSlug === "global-gateway" ? "global" : "room";
    markVoice("RoomGW:ticket-start", { roomSlug: options.roomSlug });
    const bundle = await fetchSocketTicketBundle({
      audience,
      channelId: options.channelId,
      roomSlug: options.roomSlug,
      serverId: options.serverId,
    });
    const path =
      audience === "global"
        ? "/api/gateway"
        : `/api/channels/${options.roomSlug}/ws?v=1`;
    return {
      url: options.wsUrlGenerator(path),
      protocols: bundle.protocols,
      mediaBootstrap: bundle.mediaBootstrap,
      roomSlug: options.roomSlug,
    };
  }

  protected onTicket(ticket: RoomSocketTicket) {
    markVoice("RoomGW:ticket-done", { roomSlug: ticket.roomSlug });
    if (ticket.mediaBootstrap) {
      this.emit("media-bootstrap", ticket.mediaBootstrap);
    }
  }

  protected onTicketFailed(error: unknown) {
    this.log.error("Failed to open room socket", error);
    this.emit("error", { message: "Could not open room socket" });
  }

  public refreshProfile() {
    this.send({ op: VoiceOpcode.ProfileRefresh, d: {} });
  }

  public disconnect() {
    this.sessionId = null;
    this.participantId = null;
    this.lastReplayableSeq = 0;
    super.disconnect();
  }

  protected onFrame(frame: GatewayFrame) {
    const seq = readReplaySeq(frame);
    if (seq !== undefined && seq > this.lastReplayableSeq) {
      this.lastReplayableSeq = seq;
    }
  }

  protected handleMessage(msg: RoomGatewayServerMessage) {
    switch (msg.op) {
      case VoiceOpcode.Hello: {
        this.log.info("Hello received");
        if (this.sessionId && this.participantId) {
          this.log.info(`Attempting resume for session ${this.participantId}`);
          this.send(
            {
              op: VoiceOpcode.Resume,
              d: {
                session_id: this.participantId,
                seq_ack: this.lastReplayableSeq,
              },
            },
            true,
          );
        } else {
          this.send(
            { op: VoiceOpcode.Identify, d: this.identifyPayload() },
            true,
          );
        }
        break;
      }

      case VoiceOpcode.MediaReady: {
        const ready = msg.d;
        this.emit("media-ready", {
          participantId: ready.participant_id,
          iceServers: ready.ice_servers,
          voiceToken: ready.voice_token,
        });
        break;
      }

      case VoiceOpcode.Ready: {
        const ready = msg.d;
        this.participantId = ready.participant_id;
        this.sessionId = ready.participant_id;

        const tracksToQueue: TrackInfo[] = [];
        for (const p of ready.participants ?? []) {
          for (const t of p.tracks ?? []) {
            tracksToQueue.push(t);
          }
        }

        this.socket.markReady();

        this.emit("ready", {
          participantId: ready.participant_id,
          sessionId: ready.participant_id,
          iceServers: ready.ice_servers,
          voiceToken: ready.voice_token,
          tracksToQueue,
          participants: ready.participants ?? [],
          spatialAudioState: ready.spatial_audio_state,
        });
        break;
      }

      case VoiceOpcode.Resumed: {
        this.log.info("Session resumed successfully");
        const resumed = msg.d;

        this.socket.markReady();

        this.emit("resumed", {
          voiceToken: resumed.voice_token,
          iceServers: resumed.ice_servers,
          participants: resumed.participants ?? [],
          spatialAudioState: resumed.spatial_audio_state,
        });
        break;
      }

      case VoiceOpcode.VoiceStateUpdate: {
        const vsu = msg.d;
        this.emit("voice-state-update", {
          participant: vsu.participant,
          action: vsu.action,
          spatialAudioState: vsu.spatial_audio_state,
        });
        if (vsu.action === "join")
          this.emit("participant-joined", { participant: vsu.participant });
        else if (vsu.action === "leave")
          this.emit("participant-left", { participantId: vsu.participant.id });
        break;
      }

      case VoiceOpcode.ProfileUpdate: {
        const pu = msg.d;
        this.emit("profile-update", {
          participantId: pu.participant_id,
          name: pu.name,
          username: pu.username ?? undefined,
          displayName: pu.display_name,
          avatarUrl: pu.avatar_url,
          avatarDisplay: pu.avatar_display,
        });
        break;
      }

      case VoiceOpcode.Error: {
        const err = msg.d;
        this.log.error(`Error (code=${err.code}):`, err.message);

        if (err.code === GatewayCloseCode.SessionInvalid) {
          this.log.warn("Resume failed — falling back to fresh Identify");
          this.sessionId = null;
          this.participantId = null;
          this.lastReplayableSeq = 0;
          this.send(
            { op: VoiceOpcode.Identify, d: this.identifyPayload() },
            true,
          );
          break;
        }

        this.emit("error", { message: err.message, code: err.code });
        break;
      }
    }
  }

  // --- External API for sending specific messages ---

  public promoteStandby(voice?: {
    selfMute?: boolean;
    selfDeaf?: boolean;
  }): void {
    if (this.options) this.options = { ...this.options, standby: false };
    this.send({
      op: VoiceOpcode.VoiceStateUpdate,
      d: {
        promote_standby: true,
        ...(voice?.selfMute !== undefined ? { self_mute: voice.selfMute } : {}),
        ...(voice?.selfDeaf !== undefined ? { self_deaf: voice.selfDeaf } : {}),
      },
    });
  }

  private identifyPayload() {
    return {
      name: this.options?.name || "Guest",
      username: this.options?.username,
      display_name: this.options?.displayName,
      avatar_url: this.options?.avatarUrl,
      avatar_display: this.options?.avatarDisplay,
      clerk_user_id: this.options?.clerkUserId,
      supports_voice_state_deltas: true,
      ...(this.options?.standby ? { standby: true } : {}),
    };
  }

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
    return this.socket.isReady;
  }
}
