import {
  PartyTracks,
  type PartyTracksConfig,
  type TrackMetadata,
} from "partytracks/client";
import {
  distinctUntilChanged,
  EMPTY,
  map,
  of,
  tap,
  type Observable,
  type Subscription,
} from "rxjs";
import {
  observePullErrors,
  type PartyTracksApiHistory,
  type PartyTracksPullError,
} from "./partytracks-pull-errors";
import type { IceServer, TrackInfo } from "./track-info";

const BOOTSTRAP_STUN_SERVERS: IceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

type PushOptions = Parameters<PartyTracks["push"]>[1];
type PullOptions = Parameters<PartyTracks["pull"]>[1];

export interface PartyTracksClient {
  readonly peerConnection$: Observable<RTCPeerConnection>;
  readonly session$: Observable<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>;
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  /** PartyTracks' API log; read for SFU errors its retries swallow. */
  readonly history?: PartyTracksApiHistory;
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
  iceServers?: IceServer[];
}

export interface RalphPublishedTrack {
  participantId: string;
  trackName: string;
  kind: "audio" | "video";
}

export interface RalphPushOptions {
  /**
   * Simulcast encodings (with RIDs, highest first). The publication announces
   * the RIDs its sender actually negotiated as `simulcast_rids`.
   */
  sendEncodings?: readonly RTCRtpEncodingParameters[];
}

export interface RalphPullOptions {
  /**
   * The simulcast layer to pull; undefined pulls a publication's single
   * layer. A change after the pull started switches layers through the SFU's
   * tracks/update, without renegotiating or replacing the track.
   */
  preferredRid$?: Observable<string | undefined>;
}

/**
 * The RIDs `track`'s sender negotiated, highest first, when it negotiated
 * more than one: a browser or SFU that declines simulcast leaves a single
 * encoding, and that publication is announced as single-layer.
 */
export function negotiatedSimulcastRids(
  peerConnection: RTCPeerConnection | null,
  track: MediaStreamTrack | null,
): string[] | undefined {
  if (!peerConnection || !track) return undefined;
  for (const sender of peerConnection.getSenders()) {
    if (sender.track !== track) continue;
    const rids = (sender.getParameters().encodings ?? [])
      .map((encoding) => encoding.rid)
      .filter((rid): rid is string => typeof rid === "string" && rid !== "");
    if (rids.length > 1) return rids;
  }
  return undefined;
}

export interface PartyTracksTransportOptions {
  factory?: (config: PartyTracksConfig) => PartyTracksClient;
  /**
   * The API URL for a path (web: the app's API origin; the Expo app: its
   * configured API base). Defaults to the path itself (same origin).
   */
  resolveApiUrl?: (path: string) => string;
  /**
   * Runs on every PartyTracks peer connection before anything is negotiated
   * on it (web: the Opus ptime preference, src/lib/voice/opus-ptime.ts).
   */
  configurePeerConnection?: (peerConnection: RTCPeerConnection) => void;
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

function toPartyTracksMetadata(track: TrackInfo): TrackMetadata {
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
  /**
   * SFU errors of pulls PartyTracks is retrying, per requested track (it
   * names tracks by SFU session id and SFU track name).
   */
  readonly pullErrors$: Observable<PartyTracksPullError>;

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
    this.iceServers = [
      ...(credentials.iceServers?.length
        ? credentials.iceServers
        : BOOTSTRAP_STUN_SERVERS),
    ];
    const resolveApiUrl = options.resolveApiUrl ?? ((path: string) => path);
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
    this.pullErrors$ = this.client.history
      ? observePullErrors(this.client.history)
      : EMPTY;
    const configurePeerConnection = options.configurePeerConnection;
    this.peerConnectionSubscription = this.peerConnection$.subscribe(
      (peerConnection) => {
        this.activePeerConnection = peerConnection;
        // Before PartyTracks negotiates anything on this connection.
        configurePeerConnection?.(peerConnection);
      },
    );
  }

  /** The current peer connection (for stats); null before the first one. */
  get peerConnection(): RTCPeerConnection | null {
    return this.activePeerConnection;
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
    options: RalphPushOptions = {},
  ): Observable<TrackInfo> {
    const sendEncodings = options.sendEncodings;
    let currentTrack: MediaStreamTrack | null = null;
    // PartyTracks re-emits a push's metadata as soon as it hands a new source
    // track to sender.replaceTrack(), but sender.track changes only once that
    // resolves, so the sender cannot be found by the new track then. The
    // negotiated layers belong to the SFU track (one transceiver), not to the
    // source track: read them once per SFU track and keep them across
    // replacements (device switch, recovery).
    let negotiated: { sfuTrack: string; rids: string[] | undefined } | null =
      null;
    const negotiatedRids = (track: TrackInfo): string[] | undefined => {
      const sfuTrack = `${track.session_id}/${track.sfu_track_name}`;
      if (negotiated?.sfuTrack !== sfuTrack) {
        negotiated = {
          sfuTrack,
          rids: negotiatedSimulcastRids(
            this.activePeerConnection,
            currentTrack,
          ),
        };
      }
      return negotiated.rids;
    };
    const pushOptions: PushOptions | undefined = sendEncodings
      ? {
          sendEncodings$: of(
            sendEncodings.map((encoding) => ({ ...encoding })),
          ),
        }
      : undefined;
    return this.client
      .push(
        sourceTrack$.pipe(tap((track) => (currentTrack = track))),
        pushOptions,
      )
      .pipe(
        map((metadata) => {
          const track: TrackInfo = {
            participant_id: identity.participantId,
            track_name: identity.trackName,
            sfu_track_name: requireMetadataField(metadata, "trackName"),
            session_id: requireMetadataField(metadata, "sessionId"),
            kind: identity.kind,
          };
          const rids = sendEncodings ? negotiatedRids(track) : undefined;
          return rids ? { ...track, simulcast_rids: rids } : track;
        }),
      );
  }

  pull(
    track$: Observable<TrackInfo>,
    options: RalphPullOptions = {},
  ): Observable<MediaStreamTrack> {
    const pullOptions: PullOptions | undefined = options.preferredRid$
      ? {
          simulcast: {
            preferredRid$: options.preferredRid$.pipe(distinctUntilChanged()),
          },
        }
      : undefined;
    return this.client.pull(
      track$.pipe(map(toPartyTracksMetadata)),
      pullOptions,
    );
  }
}
