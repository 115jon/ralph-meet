import {
  VoiceOpcode,
  type ClientDisconnectPayload,
  type NegotiationDonePayload,
  type ServerMessage,
  type SessionDescriptionPayload,
  type TrackInfo,
} from "@/lib/types";
import { markVoice } from "@/lib/voice/latency-marks";
import { fetchSocketProtocols } from "@/lib/voice/socket-ticket-client";
import { BaseGateway, type BaseGatewayEvents } from "./base-gateway";

export interface VoiceGatewayEvents extends BaseGatewayEvents {
  "voice-ready": {
    speaking?: Record<string, number>;
    tracks?: TrackInfo[];
  };
  "track-offered": TrackInfo;
  "session-description": SessionDescriptionPayload;
  "negotiation-done": NegotiationDonePayload;
  speaking: { participantId: string; speaking: number };
  "client-disconnect": ClientDisconnectPayload;
  "stop-tracks": { track_names: string[]; tracks?: TrackInfo[] };
  "app-event": Record<string, unknown>;
  error: {
    message: string;
    code?: number;
    request_id?: string;
    operation?: "push";
    push_prefix?: "screen";
  };
}

export class VoiceGateway extends BaseGateway<VoiceGatewayEvents> {
  private participantId: string | null = null;
  private voiceToken: string | null = null;
  private roomSlug: string | null = null;
  private wsUrlGenerator: ((path: string) => string) | null = null;
  private ticketContext: { channelId?: string; serverId?: string } = {};
  private connecting = false;
  private reconnectQueued = false;
  private helloReceived = false;
  private identifySent = false;
  private identifiedParticipantId: string | null = null;
  private identifiedVoiceToken: string | null = null;
  private clearCredentialsOnNextPrepare = false;

  constructor() {
    super("VoiceGW", VoiceOpcode.Heartbeat);
    this.on("disconnected", () => {
      this.resetSocketIdentityState();
    });
  }

  public prepareVoice(
    roomSlug: string,
    wsUrlGenerator: (path: string) => string,
    ticketContext: { channelId?: string; serverId?: string },
  ) {
    if (this.clearCredentialsOnNextPrepare) {
      this.participantId = null;
      this.voiceToken = null;
      this.clearCredentialsOnNextPrepare = false;
      if (this.connecting) {
        this.connectionRequestGeneration++;
        this.reconnectQueued = true;
      }
    }
    this.roomSlug = roomSlug;
    this.wsUrlGenerator = wsUrlGenerator;
    this.ticketContext = ticketContext;
    this.isLeaving = false;

    if (!this.ws && !this.connecting) {
      void this.openVoiceSocket(true);
    }
  }

  public connectVoice(
    participantId: string,
    voiceToken: string,
    roomSlug: string,
    wsUrlGenerator: (path: string) => string,
    ticketContext: { channelId?: string; serverId?: string },
  ) {
    this.clearCredentialsOnNextPrepare = false;
    const replacingIdentifiedGeneration =
      this.identifySent &&
      (this.identifiedParticipantId !== participantId ||
        this.identifiedVoiceToken !== voiceToken);

    this.participantId = participantId;
    this.voiceToken = voiceToken;
    this.roomSlug = roomSlug;
    this.wsUrlGenerator = wsUrlGenerator;
    this.ticketContext = ticketContext;
    this.isLeaving = false;

    if (replacingIdentifiedGeneration) {
      super.disconnect();
      this.isLeaving = false;
      this.resetSocketIdentityState();
    }

    this.maybeSendIdentify();
    void this.openVoiceSocket(true);
  }

  private async openVoiceSocket(resetReconnectAttempt: boolean) {
    if (!this.roomSlug || !this.wsUrlGenerator) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    if (this.connecting) {
      this.reconnectQueued = true;
      return;
    }
    this.connecting = true;
    const requestGeneration = ++this.connectionRequestGeneration;
    try {
      markVoice("VoiceGW:ticket-start", { roomSlug: this.roomSlug });
      const protocols = await fetchSocketProtocols({
        audience: "voice",
        channelId: this.ticketContext.channelId,
        roomSlug: this.roomSlug,
        serverId: this.ticketContext.serverId,
      });
      if (
        this.isLeaving ||
        requestGeneration !== this.connectionRequestGeneration
      )
        return;
      markVoice("VoiceGW:ticket-done", { roomSlug: this.roomSlug });
      const url = this.wsUrlGenerator(
        `/api/channels/${this.roomSlug}/voice?v=1`,
      );
      this.resetSocketIdentityState();
      super.connect(url, resetReconnectAttempt, protocols);
    } catch (error) {
      this.log.error("Failed to open voice socket", error);
      this.emit("error", { message: "Could not open voice socket" });
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
      if (this.reconnectQueued && !this.isLeaving) {
        this.reconnectQueued = false;
        void this.openVoiceSocket(false);
      } else {
        this.reconnectQueued = false;
      }
    }
  }

  public updateVoiceToken(token: string) {
    this.voiceToken = token;
  }

  public disconnect() {
    this.resetSocketIdentityState();
    super.disconnect();
    this.clearCredentialsOnNextPrepare =
      this.participantId !== null || this.voiceToken !== null;
  }

  protected performReconnect() {
    if (this.roomSlug && this.wsUrlGenerator) {
      this.log.info(
        "Voice connection lost — attempting to reconnect while preserving WebRTC peer connections",
      );
      void this.openVoiceSocket(false);
    }
  }

  protected handleMessage(msg: ServerMessage) {
    switch (msg.op) {
      case VoiceOpcode.Hello: {
        const hello = msg.d;
        this.log.info(`Hello received, interval=${hello.heartbeat_interval}ms`);
        this.heartbeat.start(hello.heartbeat_interval);
        this.helloReceived = true;
        this.maybeSendIdentify();
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

        const vr = msg.d;
        this.emit("voice-ready", {
          speaking: vr.speaking,
          tracks: vr.tracks,
        });

        if (vr.speaking) {
          Object.entries(vr.speaking).forEach(([pId, speaking]) => {
            this.emit("speaking", {
              participantId: pId,
              speaking,
            });
          });
        }
        break;
      }

      case VoiceOpcode.SessionDescription: {
        this.emit("session-description", msg.d);
        break;
      }

      case VoiceOpcode.NegotiationDone: {
        this.emit("negotiation-done", msg.d);
        break;
      }

      case VoiceOpcode.Video: {
        const v = msg.d;
        if (Array.isArray(v.tracks)) {
          for (const track of v.tracks) {
            this.emit("track-offered", {
              ...track,
              participant_id: track.participant_id || v.participant_id,
            });
          }
        }
        break;
      }

      case VoiceOpcode.Error: {
        const err = msg.d;
        this.emit("error", {
          message: err.message,
          code: err.code,
          request_id: err.request_id,
          operation: err.operation,
          push_prefix: err.push_prefix,
        });
        break;
      }

      case VoiceOpcode.Speaking: {
        const speak = msg.d;
        this.emit("speaking", {
          participantId: speak.participant_id,
          speaking: speak.speaking,
        });
        break;
      }

      case VoiceOpcode.ClientDisconnect: {
        const disconnect = msg.d as ClientDisconnectPayload;
        if (disconnect.participant_id !== this.participantId) {
          this.emit("client-disconnect", disconnect);
        }
        break;
      }

      case VoiceOpcode.StopTracks: {
        const st = msg.d;
        this.emit("stop-tracks", {
          track_names: st.track_names,
          tracks: st.tracks,
        });
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

  public sendAppEvent(payload: Record<string, unknown>): boolean {
    const eventType = payload.type;
    if (
      typeof eventType === "string" &&
      eventType.startsWith("listen_together.") &&
      eventType !== "listen_together.state.request"
    ) {
      this.log.info("Sending listen-together command", {
        type: eventType,
        roomSlug: payload.room_slug ?? null,
        paused: payload.paused ?? null,
        entryId: payload.entryId ?? null,
        ready: this.isReady,
      });
    }
    if (
      typeof eventType === "string" &&
      eventType.startsWith("listen_together.") &&
      eventType !== "listen_together.state.request" &&
      !this.isReady
    ) {
      this.log.warn(
        `Dropping listen-together command while voice gateway is not ready: ${eventType}`,
      );
      return false;
    }

    return this.send({ op: VoiceOpcode.VoiceAppEvent, d: payload });
  }

  private resetSocketIdentityState() {
    this.helloReceived = false;
    this.identifySent = false;
    this.identifiedParticipantId = null;
    this.identifiedVoiceToken = null;
  }

  private maybeSendIdentify() {
    if (
      !this.helloReceived ||
      this.identifySent ||
      !this.participantId ||
      !this.voiceToken ||
      this.ws?.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const participantId = this.participantId;
    const voiceToken = this.voiceToken;
    if (
      !this.send(
        {
          op: VoiceOpcode.VoiceIdentify,
          d: {
            participant_id: participantId,
            voice_token: voiceToken,
            supports_listen_together_snapshot_events: true,
          },
        },
        true,
      )
    ) {
      return;
    }

    this.identifySent = true;
    this.identifiedParticipantId = participantId;
    this.identifiedVoiceToken = voiceToken;
  }
}
