// Must run before partytracks/client is evaluated (globals PartyTracks reads).
import "./webrtc-runtime";

import { PartyTracks, type TrackMetadata } from "partytracks/client";
import { map, type Observable, type Subscription } from "rxjs";

import { config } from "@/lib/config";

import type { IceServer, TrackInfo } from "./protocol";
import { toPartyTracksMetadata } from "./pull-metadata";
import { observePullErrors, type PartyTracksPullError } from "./pull-errors";

// Port of src/lib/voice/partytracks-transport.ts: the one PartyTracks session
// (peer connection) of a call. The microphone and every remote pull share it,
// so PartyTracks serialises their negotiation and rebuilds them together.
// PartyTracks itself is the workspace's patched partytracks@0.0.56 (pnpm
// patchedDependencies), the same code the web runs: tracks are announced as
// soon as the SFU accepts them, a pull waits until the peer connection has
// connected, and a failed bulk pull errors so its retry runs.

const BOOTSTRAP_STUN_SERVERS: IceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

export interface TransportCredentials {
  readonly roomSlug: string;
  readonly participantId: string;
  readonly voiceToken: string;
  readonly iceServers?: readonly IceServer[];
}

/** Ralph's name for a publication; the SFU's comes back from the push. */
export interface PublishedTrackIdentity {
  readonly participantId: string;
  readonly trackName: string;
  readonly kind: "audio" | "video";
}

function requireField(
  metadata: TrackMetadata,
  field: "trackName" | "sessionId",
): string {
  const value = metadata[field];
  if (!value) throw new Error(`PartyTracks metadata is missing ${field}`);
  return value;
}

function toRtcIceServers(servers: readonly IceServer[]): RTCIceServer[] {
  return servers.map((server) => ({
    urls: typeof server.urls === "string" ? server.urls : [...server.urls],
    username: server.username,
    credential: server.credential,
  }));
}

export class PartyTracksTransport {
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  /** SFU errors of pulls PartyTracks is retrying (see pull-errors). */
  readonly pullErrors$: Observable<PartyTracksPullError>;

  private readonly headers: Headers;
  private readonly client: PartyTracks;
  private readonly peerConnectionSubscription: Subscription;
  private activePeerConnection: RTCPeerConnection | null = null;

  constructor(credentials: TransportCredentials) {
    this.headers = new Headers({
      Authorization: `Bearer ${credentials.voiceToken}`,
      "X-Voice-Session-Id": credentials.participantId,
    });
    const iceServers = credentials.iceServers?.length
      ? credentials.iceServers
      : BOOTSTRAP_STUN_SERVERS;
    this.client = new PartyTracks({
      prefix: `${config.apiBaseUrl}/api/channels/${encodeURIComponent(
        credentials.roomSlug,
      )}/partytracks`,
      headers: this.headers,
      iceServers: toRtcIceServers(iceServers),
    });
    this.peerConnectionState$ = this.client.peerConnectionState$;
    this.pullErrors$ = observePullErrors(this.client.history);
    this.peerConnectionSubscription = this.client.peerConnection$.subscribe(
      (peerConnection) => {
        this.activePeerConnection = peerConnection;
      },
    );
  }

  /** The current peer connection, for stats; null before the first session. */
  get peerConnection(): RTCPeerConnection | null {
    return this.activePeerConnection;
  }

  /** PartyTracks reads the headers on every request. */
  updateVoiceToken(voiceToken: string): void {
    this.headers.set("Authorization", `Bearer ${voiceToken}`);
  }

  dispose(): void {
    const peerConnection = this.activePeerConnection;
    this.activePeerConnection = null;
    this.peerConnectionSubscription.unsubscribe();
    try {
      peerConnection?.close();
    } catch {
      // PartyTracks' own teardown may have closed it already.
    }
  }

  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: PublishedTrackIdentity,
  ): Observable<TrackInfo> {
    return this.client.push(sourceTrack$).pipe(
      map((metadata) => ({
        participant_id: identity.participantId,
        track_name: identity.trackName,
        sfu_track_name: requireField(metadata, "trackName"),
        session_id: requireField(metadata, "sessionId"),
        kind: identity.kind,
      })),
    );
  }

  pull(track$: Observable<TrackInfo>): Observable<MediaStreamTrack> {
    return this.client.pull(track$.pipe(map(toPartyTracksMetadata)));
  }
}
