import { apiUrl } from "@/lib/platform";
import type { IceServer, TrackInfo } from "@/lib/types";
import {
  PartyTracks,
  type PartyTracksConfig,
  type TrackMetadata,
} from "partytracks/client";
import { map, type Observable, type Subscription } from "rxjs";

type PushOptions = Parameters<PartyTracks["push"]>[1];
type PullOptions = Parameters<PartyTracks["pull"]>[1];

export interface PartyTracksClient {
  readonly peerConnection$: Observable<RTCPeerConnection>;
  readonly session$: Observable<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>;
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    options?: PushOptions,
  ): Observable<TrackMetadata>;
  pull(
    trackMetadata$: Observable<TrackMetadata>,
    options?: PullOptions,
  ): Observable<MediaStreamTrack>;
}

export interface PartyTracksTransportCredentials {
  roomSlug: string;
  participantId: string;
  voiceToken: string;
  iceServers: IceServer[];
}

export interface RalphPublishedTrack {
  participantId: string;
  trackName: string;
  kind: "audio" | "video";
}

export interface PartyTracksTransportOptions {
  factory?: (config: PartyTracksConfig) => PartyTracksClient;
  resolveApiUrl?: (path: string) => string;
}

function requireMetadataField(
  metadata: TrackMetadata,
  field: "trackName" | "sessionId",
): string {
  const value = metadata[field];
  if (!value) {
    throw new Error(`PartyTracks metadata is missing ${field}`);
  }
  return value;
}

export function toPartyTracksMetadata(track: TrackInfo): TrackMetadata {
  return {
    location: "remote",
    trackName: track.sfu_track_name ?? track.track_name,
    sessionId: track.session_id,
  };
}

/**
 * Owns the single PartyTracks WebRTC session for one Ralph voice session.
 * Microphone, camera, screen share, and all remote pulls intentionally share
 * this instance so PartyTracks can serialize negotiation and recover them as a
 * unit. Native screen capture remains outside this boundary until it exposes a
 * browser MediaStreamTrack.
 */
export class PartyTracksTransport {
  readonly peerConnection$: Observable<RTCPeerConnection>;
  readonly session$: Observable<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>;
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;

  private readonly headers: Headers;
  private readonly client: PartyTracksClient;
  private readonly iceServers: RTCIceServer[];
  private readonly peerConnectionSubscription: Subscription;
  private activePeerConnection: RTCPeerConnection | null = null;

  constructor(
    credentials: PartyTracksTransportCredentials,
    options: PartyTracksTransportOptions = {},
  ) {
    this.headers = new Headers({
      Authorization: `Bearer ${credentials.voiceToken}`,
      "X-Voice-Session-Id": credentials.participantId,
    });
    this.iceServers = [...credentials.iceServers];
    const resolveApiUrl = options.resolveApiUrl ?? apiUrl;
    const prefix = resolveApiUrl(
      `/api/channels/${encodeURIComponent(credentials.roomSlug)}/partytracks`,
    );
    const factory = options.factory ?? ((config) => new PartyTracks(config));
    this.client = factory({
      prefix,
      headers: this.headers,
      iceServers: this.iceServers,
    });
    this.peerConnection$ = this.client.peerConnection$;
    this.session$ = this.client.session$;
    this.peerConnectionState$ = this.client.peerConnectionState$;
    this.peerConnectionSubscription = this.peerConnection$.subscribe(
      (peerConnection) => {
        this.activePeerConnection = peerConnection;
      },
    );
  }

  updateVoiceToken(voiceToken: string): void {
    this.headers.set("Authorization", `Bearer ${voiceToken}`);
  }

  updateIceServers(iceServers: IceServer[]): void {
    this.iceServers.splice(0, this.iceServers.length, ...iceServers);
    if (!this.activePeerConnection) return;
    try {
      this.activePeerConnection.setConfiguration({
        ...this.activePeerConnection.getConfiguration(),
        iceServers: this.iceServers,
      });
    } catch {
      // A closing connection will be replaced by PartyTracks with the updated
      // shared ICE server array.
    }
  }

  dispose(): void {
    const peerConnection = this.activePeerConnection;
    this.activePeerConnection = null;
    if (peerConnection) {
      peerConnection.onconnectionstatechange = null;
      peerConnection.ondatachannel = null;
      peerConnection.onicecandidate = null;
      peerConnection.onicecandidateerror = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.onnegotiationneeded = null;
      peerConnection.onsignalingstatechange = null;
      peerConnection.ontrack = null;
    }
    this.peerConnectionSubscription.unsubscribe();
    try {
      peerConnection?.close();
    } catch {
      // The PartyTracks session teardown may have already closed this PC.
    }
  }

  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
    options?: PushOptions,
  ): Observable<TrackInfo> {
    return this.client.push(sourceTrack$, options).pipe(
      map((metadata) => ({
        participant_id: identity.participantId,
        track_name: identity.trackName,
        sfu_track_name: requireMetadataField(metadata, "trackName"),
        session_id: requireMetadataField(metadata, "sessionId"),
        kind: identity.kind,
      })),
    );
  }

  pull(
    track$: Observable<TrackInfo>,
    options?: PullOptions,
  ): Observable<MediaStreamTrack> {
    return this.client.pull(track$.pipe(map(toPartyTracksMetadata)), options);
  }
}
