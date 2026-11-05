import {
  GatewayCloseCode,
  GatewayOp,
  readReplaySeq,
  type MainClientPayload,
  type VoiceClientPayload,
} from "@ralph/protocol";
import {
  CALL_SOCKET_POLICY,
  isRealtimeTimeout,
  RealtimeSocket,
  type OutboundFrame,
  type SocketTicket,
} from "@ralph/realtime";

import { resetTicketRequests } from "../../../modules/ralph-network/src";

import {
  decodeRoomServerFrame,
  decodeVoiceServerFrame,
  type IceServer,
  type RepublishRequest,
  type RoomServerMessage,
  toIceServers,
  toTrackInfo,
  toTrackInfos,
  type TrackInfo,
  type VoiceAppEvent,
  type VoiceServerMessage,
  type VoiceState,
} from "./protocol";
import {
  acquireRoomTicket,
  acquireVoiceTicket,
  type CallTarget,
  type MediaBootstrap,
  type RoomTicket,
} from "./tickets";

// The two sockets of a call, as the web's RoomGateway and VoiceGateway
// (src/lib/voice/gateways/*) speak them, on the shared RealtimeSocket
// lifecycle (tickets, heartbeat, backoff, wake). Only the protocol lives here;
// what the messages mean for the call is the session's business.

/** Why a socket stopped for good (RealtimeSocket gives up; no retry). */
export type SocketGiveUp = "admission-rejected" | "replaced" | "auth-failed";

export interface MediaCredentials {
  readonly participantId: string;
  readonly voiceToken: string;
  readonly iceServers?: readonly IceServer[];
}

// ── Room socket (MeetingRoom) ───────────────────────────────────────────────

export interface RoomSocketHandlers {
  /** A ticket's media bootstrap: credentials before Identify is answered. */
  mediaBootstrap(credentials: MediaBootstrap): void;
  /** MediaReady (early, after Identify) or a credential refresh. */
  mediaReady(credentials: MediaCredentials): void;
  /**
   * Ready. Its credentials are absent when the join's admission already
   * carried them (the ticket's media bootstrap, same participant).
   */
  ready(
    credentials: Partial<MediaCredentials> & { readonly participantId: string },
    participants: readonly VoiceState[],
  ): void;
  resumed(
    credentials: Partial<MediaCredentials>,
    participants?: readonly VoiceState[],
  ): void;
  voiceStateUpdate(
    participant: VoiceState,
    action: "join" | "leave" | "update",
  ): void;
  profileUpdate(update: {
    participantId: string;
    name: string;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  }): void;
  error(code: number, message: string): void;
  /** The ticket request failed; RealtimeSocket retries unless it gave up. */
  ticketFailed(error: unknown): void;
  disconnected(giveUp: SocketGiveUp | null): void;
}

export class RoomSocket {
  private readonly socket: RealtimeSocket<RoomServerMessage, RoomTicket>;
  /** Set by Ready: a reconnect resumes this session instead of identifying. */
  private participantId: string | null = null;
  private lastReplayableSeq = 0;

  constructor(
    target: CallTarget,
    private readonly identify: MainClientPayload<GatewayOp.Identify>,
    private readonly handlers: RoomSocketHandlers,
  ) {
    this.socket = new RealtimeSocket<RoomServerMessage, RoomTicket>({
      label: "RoomGW",
      policy: CALL_SOCKET_POLICY,
      decode: decodeRoomServerFrame,
      acquireTicket: (signal) => acquireRoomTicket(target, signal),
      hooks: {
        ticketReady: (ticket) => {
          if (ticket.mediaBootstrap) {
            this.handlers.mediaBootstrap(ticket.mediaBootstrap);
          }
        },
        ticketFailed: (error) => {
          if (isRealtimeTimeout(error)) {
            resetTicketRequests("room ticket timed out");
          }
          this.handlers.ticketFailed(error);
        },
        authFailed: () => this.handlers.disconnected("auth-failed"),
        frame: (frame) => {
          const seq = readReplaySeq(frame);
          if (seq !== undefined && seq > this.lastReplayableSeq) {
            this.lastReplayableSeq = seq;
          }
        },
        message: (message) => this.handleMessage(message),
        closed: ({ next }) =>
          this.handlers.disconnected(next === "retry" ? null : next),
      },
    });
  }

  get isReady(): boolean {
    return this.socket.isReady;
  }

  connect(): void {
    this.socket.connect({ freshTicket: true });
  }

  wake(options: { readonly networkChanged?: boolean } = {}): void {
    this.socket.wake(options);
  }

  /** Sends once identified (queued until then). */
  send(frame: OutboundFrame): void {
    this.socket.sendWhenReady(frame);
  }

  sendVoiceState(d: MainClientPayload<GatewayOp.VoiceStateUpdate>): void {
    this.send({ op: GatewayOp.VoiceStateUpdate, d });
  }

  requestCredentialRefresh(): void {
    this.send({ op: GatewayOp.RefreshVoiceCredentials, d: {} });
  }

  /** Leave: say goodbye if we can, close, never reconnect. */
  stop(): void {
    if (this.socket.isReady) {
      this.socket.sendJson({ op: GatewayOp.ClientDisconnect, d: {} });
    }
    this.socket.stop();
    this.participantId = null;
    this.lastReplayableSeq = 0;
  }

  private sendIdentify(): void {
    this.socket.sendJson({ op: GatewayOp.Identify, d: this.identify });
  }

  private handleMessage(message: RoomServerMessage): void {
    switch (message.op) {
      case GatewayOp.Hello:
        if (this.participantId) {
          this.socket.sendJson({
            op: GatewayOp.Resume,
            d: {
              session_id: this.participantId,
              seq_ack: this.lastReplayableSeq,
            },
          });
        } else {
          this.sendIdentify();
        }
        return;
      case GatewayOp.MediaReady:
        this.handlers.mediaReady({
          participantId: message.d.participant_id,
          voiceToken: message.d.voice_token,
          iceServers: toIceServers(message.d.ice_servers),
        });
        return;
      case GatewayOp.Ready:
        this.participantId = message.d.participant_id;
        this.socket.markReady();
        this.handlers.ready(
          {
            participantId: message.d.participant_id,
            ...(message.d.voice_token
              ? { voiceToken: message.d.voice_token }
              : {}),
            ...(message.d.ice_servers
              ? { iceServers: toIceServers(message.d.ice_servers) }
              : {}),
          },
          message.d.participants ?? [],
        );
        return;
      case GatewayOp.Resumed:
        this.socket.markReady();
        this.handlers.resumed(
          {
            voiceToken: message.d.voice_token,
            iceServers: message.d.ice_servers
              ? toIceServers(message.d.ice_servers)
              : undefined,
          },
          message.d.participants,
        );
        return;
      case GatewayOp.VoiceStateUpdate:
        this.handlers.voiceStateUpdate(message.d.participant, message.d.action);
        return;
      case GatewayOp.ProfileUpdate:
        this.handlers.profileUpdate({
          participantId: message.d.participant_id,
          name: message.d.name,
          username: message.d.username,
          displayName: message.d.display_name,
          avatarUrl: message.d.avatar_url,
        });
        return;
      case GatewayOp.Error:
        if (message.d.code === GatewayCloseCode.SessionInvalid) {
          // Resume impossible: identify afresh, as RoomGateway does.
          this.participantId = null;
          this.lastReplayableSeq = 0;
          this.sendIdentify();
          return;
        }
        this.handlers.error(message.d.code, message.d.message);
        return;
      default:
        return;
    }
  }
}

// ── Voice socket (VoiceRoom) ────────────────────────────────────────────────

export interface VoiceSocketHandlers {
  voiceReady(
    tracks: readonly TrackInfo[],
    speaking: Readonly<Record<string, number>>,
  ): void;
  trackOffered(track: TrackInfo): void;
  speaking(participantId: string, flags: number): void;
  clientDisconnect(participantId: string): void;
  stopTracks(
    trackNames: readonly string[],
    tracks?: readonly TrackInfo[],
  ): void;
  republishRequest(request: RepublishRequest): void;
  appEvent(event: VoiceAppEvent): void;
  error(code: number, message: string): void;
  disconnected(giveUp: SocketGiveUp | null): void;
}

/**
 * Signalling only (track metadata, speaking): the peer connection lives in
 * the transport and survives a reconnect of this socket, which identifies
 * again and gets the room's tracks replayed on VoiceReady.
 */
export class VoiceSocket {
  private readonly socket: RealtimeSocket<VoiceServerMessage, SocketTicket>;
  private credentials: { participantId: string; voiceToken: string } | null =
    null;
  private helloReceived = false;
  private identifiedParticipantId: string | null = null;
  /** holdIdentify(): the room may be about to name a new participant. */
  private identifyHeld = false;

  constructor(
    target: CallTarget,
    private readonly handlers: VoiceSocketHandlers,
  ) {
    this.socket = new RealtimeSocket<VoiceServerMessage, SocketTicket>({
      label: "VoiceGW",
      policy: CALL_SOCKET_POLICY,
      decode: decodeVoiceServerFrame,
      // Bound to the participant it will identify as, when known (the
      // voice room closes 1013 on a mismatch and this asks again).
      acquireTicket: (signal) =>
        acquireVoiceTicket(
          target,
          this.credentials?.participantId ?? null,
          signal,
        ),
      hooks: {
        ticketReady: () => this.resetIdentity(),
        ticketFailed: (error) => {
          if (isRealtimeTimeout(error)) {
            resetTicketRequests("voice ticket timed out");
          }
        },
        authFailed: () => this.handlers.disconnected("auth-failed"),
        message: (message) => this.handleMessage(message),
        closed: ({ next }) => {
          this.resetIdentity();
          this.handlers.disconnected(next === "retry" ? null : next);
        },
      },
    });
  }

  get isReady(): boolean {
    return this.socket.isReady;
  }

  /** Opens the socket early; it identifies once it has credentials. */
  connect(): void {
    this.socket.connect();
  }

  wake(options: { readonly networkChanged?: boolean } = {}): void {
    this.socket.wake(options);
  }

  /**
   * Identifies as `participantId`. A fresh token for the participant already
   * identified is kept for the next identify (the room admitted this socket);
   * a different participant needs a new socket.
   */
  connectVoice(participantId: string, voiceToken: string): void {
    const replacing =
      this.identifiedParticipantId !== null &&
      this.identifiedParticipantId !== participantId;
    this.credentials = { participantId, voiceToken };
    this.identifyHeld = false;
    if (replacing) {
      this.socket.stop();
      this.resetIdentity();
    }
    this.maybeIdentify();
    this.socket.connect();
  }

  /**
   * Keeps the next VoiceIdentify back until connectVoice() or
   * releaseIdentify(). After a network change the room socket reconnects
   * too, and may come back as a new participant (Ready, not Resumed): a
   * voice socket that identified first would name the old one, which the
   * voice room refuses (4008 once its join grant is gone, 4010 while held).
   */
  holdIdentify(): void {
    this.identifyHeld = true;
  }

  /** The room resumed: identify as the participant we already are. */
  releaseIdentify(): void {
    if (!this.identifyHeld) return;
    this.identifyHeld = false;
    this.maybeIdentify();
  }

  updateVoiceToken(voiceToken: string): void {
    if (this.credentials)
      this.credentials = { ...this.credentials, voiceToken };
    // An identify the voice room refused (expired token) goes again now.
    this.maybeIdentify();
  }

  /** Sends once identified (queued until VoiceReady). */
  send(frame: OutboundFrame): void {
    this.socket.sendWhenReady(frame);
  }

  sendSpeaking(flags: number): void {
    const d: VoiceClientPayload<GatewayOp.Speaking> = { speaking: flags };
    this.send({ op: GatewayOp.Speaking, d });
  }

  stop(): void {
    if (this.socket.isReady) {
      this.socket.sendJson({ op: GatewayOp.ClientDisconnect, d: {} });
    }
    this.socket.stop();
    this.resetIdentity();
    this.credentials = null;
    this.identifyHeld = false;
  }

  private resetIdentity(): void {
    this.helloReceived = false;
    this.identifiedParticipantId = null;
  }

  private maybeIdentify(): void {
    const credentials = this.credentials;
    if (
      this.identifyHeld ||
      !this.helloReceived ||
      this.identifiedParticipantId !== null ||
      !credentials ||
      !this.socket.isOpen
    ) {
      return;
    }
    const d: VoiceClientPayload<GatewayOp.VoiceIdentify> = {
      participant_id: credentials.participantId,
      voice_token: credentials.voiceToken,
    };
    if (this.socket.sendJson({ op: GatewayOp.VoiceIdentify, d })) {
      this.identifiedParticipantId = credentials.participantId;
    }
  }

  private handleMessage(message: VoiceServerMessage): void {
    switch (message.op) {
      case GatewayOp.Hello:
        this.helloReceived = true;
        this.maybeIdentify();
        return;
      case GatewayOp.VoiceReady:
        this.socket.markReady();
        this.handlers.voiceReady(
          toTrackInfos(message.d.tracks ?? []),
          message.d.speaking ?? {},
        );
        return;
      case GatewayOp.Video:
        for (const wire of message.d.tracks) {
          const track = toTrackInfo(wire);
          if (!track) continue;
          this.handlers.trackOffered({
            ...track,
            participant_id: track.participant_id || message.d.participant_id,
          });
        }
        return;
      case GatewayOp.Speaking:
        this.handlers.speaking(message.d.participant_id, message.d.speaking);
        return;
      case GatewayOp.ClientDisconnect:
        if (message.d.participant_id !== this.credentials?.participantId) {
          this.handlers.clientDisconnect(message.d.participant_id);
        }
        return;
      case GatewayOp.StopTracks:
        this.handlers.stopTracks(
          message.d.track_names,
          message.d.tracks && toTrackInfos(message.d.tracks),
        );
        return;
      case GatewayOp.RepublishRequest:
        this.handlers.republishRequest(message.d);
        return;
      case GatewayOp.VoiceAppEvent:
        this.handlers.appEvent(message.d);
        return;
      case GatewayOp.Error:
        if (
          message.d.code === GatewayCloseCode.AuthenticationFailed &&
          this.identifiedParticipantId !== null &&
          !this.socket.isReady
        ) {
          // The voice room refused our identify (an expired token) and keeps
          // the socket open: identify again once the refreshed token arrives.
          this.identifiedParticipantId = null;
        }
        this.handlers.error(message.d.code, message.d.message);
        return;
      default:
        return;
    }
  }
}
