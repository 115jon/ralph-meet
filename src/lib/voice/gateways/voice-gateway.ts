import {
  decodeVoiceGatewayServerFrame,
  type VoiceGatewayServerMessage,
} from "@/lib/gateway-protocol";
import {
  VoiceOpcode,
  type ClientDisconnectPayload,
  type NegotiationDonePayload,
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

interface VoiceSocketTarget {
  readonly roomSlug: string;
  readonly wsUrlGenerator: (path: string) => string;
  readonly ticketContext: { channelId?: string; serverId?: string };
}

/**
 * The voice socket (VoiceRoom DO): media metadata, speaking and app events.
 * It carries signalling only; the WebRTC peer connections live in SFUClient
 * and survive a reconnect of this socket, which re-identifies and replays
 * the room's tracks on VoiceReady.
 */
export class VoiceGateway extends BaseGateway<
  VoiceGatewayEvents,
  VoiceGatewayServerMessage
> {
  private participantId: string | null = null;
  private voiceToken: string | null = null;
  private target: VoiceSocketTarget | null = null;
  private helloReceived = false;
  private identifySent = false;
  private identifiedParticipantId: string | null = null;
  private identifiedVoiceToken: string | null = null;
  private clearCredentialsOnNextPrepare = false;

  constructor() {
    super("VoiceGW", decodeVoiceGatewayServerFrame);
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
    }
    this.target = { roomSlug, wsUrlGenerator, ticketContext };
    this.socket.connect();
  }

  public connectVoice(
    participantId: string,
    voiceToken: string,
    roomSlug: string,
    wsUrlGenerator: (path: string) => string,
    ticketContext: { channelId?: string; serverId?: string },
  ) {
    this.clearCredentialsOnNextPrepare = false;
    // Only a new participant needs a new socket. A fresh token for the
    // participant this socket already identified (the room's Ready after the
    // ticket's bootstrap token, a credential refresh) is kept for the next
    // identify; the voice room has already admitted this socket.
    const replacingIdentifiedGeneration =
      this.identifySent && this.identifiedParticipantId !== participantId;
    if (this.identifySent && !replacingIdentifiedGeneration) {
      this.identifiedVoiceToken = voiceToken;
    }

    this.participantId = participantId;
    this.voiceToken = voiceToken;
    this.target = { roomSlug, wsUrlGenerator, ticketContext };

    if (replacingIdentifiedGeneration) {
      this.socket.stop();
      this.resetSocketIdentityState();
    }

    this.maybeSendIdentify();
    this.socket.connect();
  }

  protected async acquireTicket() {
    const target = this.target;
    if (!target) throw new Error("Voice socket has no room to connect to");
    markVoice("VoiceGW:ticket-start", { roomSlug: target.roomSlug });
    const protocols = await fetchSocketProtocols({
      audience: "voice",
      channelId: target.ticketContext.channelId,
      roomSlug: target.roomSlug,
      serverId: target.ticketContext.serverId,
    });
    return {
      url: target.wsUrlGenerator(`/api/channels/${target.roomSlug}/voice?v=1`),
      protocols,
    };
  }

  protected onTicket() {
    markVoice("VoiceGW:ticket-done", { roomSlug: this.target?.roomSlug });
    this.resetSocketIdentityState();
  }

  protected onTicketFailed(error: unknown) {
    this.log.error("Failed to open voice socket", error);
    this.emit("error", { message: "Could not open voice socket" });
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

  protected handleMessage(msg: VoiceGatewayServerMessage) {
    switch (msg.op) {
      case VoiceOpcode.Hello: {
        this.log.info("Hello received");
        this.helloReceived = true;
        this.maybeSendIdentify();
        break;
      }

      case VoiceOpcode.VoiceReady: {
        this.socket.markReady();

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
        const disconnect = msg.d;
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
        this.emit("app-event", msg.d);
        break;
      }
    }
  }

  // --- External API ---

  public get isReady() {
    return this.socket.isReady;
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
      !this.socket.isOpen
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
