import type { TrackInfo } from "@ralph/voice-media";
import {
  MediaStream as NativeMediaStream,
  type MediaStreamTrack as NativeMediaStreamTrack,
} from "react-native-webrtc";

import { registerRenderStream, unregisterRenderStream } from "./render-demand";
import { updateCall, type ParticipantVideo } from "./store";

// Remote camera and screen video of one call. Video is opt-in on the media
// manager (optInTrackPrefixes): a publication is pulled only once the call
// screen watches (it is up and the app is in front, or in PiP).
//
// Once pulled, it stays pulled while the app is in front, even when the
// screen stops watching (another screen, the call minimised): closing a
// pull and pulling it again on the same session can fail (the SFU recycles
// the m-line under the same MID with other RTP header extension IDs, which
// libwebrtc rejects; packages/voice/SCREEN_SHARE.md, "Watching"). Meanwhile
// nothing renders it, so a web camera drops to its lowest simulcast layer,
// and the store shows no video; a single-layer source (a screen share, a
// phone camera) keeps its rate.
//
// In the background (not PiP) every video pull closes, so a phone in a
// pocket receives no video at all. Video pulls run on their own PartyTracks
// session (./split-transport), which goes once they have closed; back in
// front, watching pulls them on a new session, where no closed m-line is
// recycled.
//
// Aliases follow the web's publishTracks(stream, prefix): `cam-video-<id>`
// for a camera, `screen-video-<id>` for a screen share. A native (desktop
// hardware) screen share has no SFU track name and is never pulled, as on
// the web.

type Slot = keyof ParticipantVideo;

interface Shown {
  readonly participantId: string;
  readonly slot: Slot;
  readonly track: MediaStreamTrack;
  readonly stream: NativeMediaStream;
  readonly url: string;
}

/** The call connection's side of remote video. */
export interface VideoSubscriber {
  /** The media manager's per-alias subscription. */
  setRemoteTrackSubscription(trackName: string, subscribe: boolean): void;
  /** Closes every video pull nobody subscribes to, kept ones included. */
  releaseUnwatchedVideo(): void;
}

/** A video publication the PartyTracks transport can pull. */
export function isPullableVideo(track: TrackInfo): boolean {
  return track.kind === "video" && Boolean(track.sfu_track_name);
}

/** The aliases pulled only while watched, and kept once pulled. */
export const VIDEO_TRACK_PREFIXES: readonly string[] = [
  "cam-video-",
  "screen-video-",
];

export function isVideoAlias(trackName: string): boolean {
  return VIDEO_TRACK_PREFIXES.some((prefix) => trackName.startsWith(prefix));
}

function slotOf(trackName: string): Slot {
  return trackName.startsWith("screen-") ? "screen" : "camera";
}

function setVideo(participantId: string, slot: Slot, url: string | null) {
  updateCall((call) => {
    const previous = call.videos[participantId] ?? {
      camera: null,
      screen: null,
    };
    if (previous[slot] === url) return call;
    const next: ParticipantVideo = { ...previous, [slot]: url };
    const videos = { ...call.videos };
    if (next.camera === null && next.screen === null) {
      delete videos[participantId];
    } else {
      videos[participantId] = next;
    }
    return { ...call, videos };
  });
}

export class RemoteVideo {
  /** Video aliases offered to us now (the subscription follows watching). */
  private readonly offered = new Set<string>();
  private readonly shown = new Map<string, Shown>();
  /** What the call screen asks for. */
  private watching = false;
  /** The app is in the background (PiP does not count). */
  private background = false;
  /** What the manager was last told: watching, unless in the background. */
  private subscribed = false;

  constructor(private readonly subscriber: () => VideoSubscriber | null) {}

  get isWatching(): boolean {
    return this.subscribed;
  }

  /** Before the manager hears of an offered video alias. */
  noteOffer(trackName: string): void {
    if (this.offered.has(trackName)) return;
    this.offered.add(trackName);
    if (this.subscribed) {
      this.subscriber()?.setRemoteTrackSubscription(trackName, true);
    }
  }

  /**
   * The alias ended (StopTracks, the participant left). Its pull may be
   * parked for the next publication; that one is pulled once offered and
   * watched, like any other.
   */
  forget(trackName: string): void {
    if (!this.offered.delete(trackName)) return;
    this.subscriber()?.setRemoteTrackSubscription(trackName, false);
  }

  setWatching(watching: boolean): void {
    this.watching = watching;
    this.apply();
  }

  /**
   * The app went to the background (outside PiP) or came back. In the
   * background every video pull closes; back in front, what the call screen
   * watches is pulled afresh.
   */
  setBackground(background: boolean): void {
    if (background === this.background) return;
    this.background = background;
    this.apply();
    if (background) this.subscriber()?.releaseUnwatchedVideo();
  }

  private apply(): void {
    const subscribed = this.watching && !this.background;
    if (subscribed === this.subscribed) return;
    this.subscribed = subscribed;
    const subscriber = this.subscriber();
    for (const trackName of this.offered) {
      subscriber?.setRemoteTrackSubscription(trackName, subscribed);
    }
    // Kept pulls carry on; the store shows them only while watched.
    for (const shown of this.shown.values()) {
      setVideo(shown.participantId, shown.slot, subscribed ? shown.url : null);
    }
  }

  /** The media manager's onRemoteTrack, for video tracks. */
  onTrack(
    action: "add" | "remove",
    track: MediaStreamTrack,
    trackInfo: TrackInfo,
  ): void {
    const trackName = trackInfo.track_name;
    if (action === "remove") {
      if (this.shown.get(trackName)?.track === track) this.hide(trackName);
      return;
    }
    if (this.shown.get(trackName)?.track === track) return;
    this.hide(trackName);
    // react-native-webrtc's tracks are what the DOM types call MediaStreamTrack.
    const stream = new NativeMediaStream([
      track as unknown as NativeMediaStreamTrack,
    ]);
    const url = stream.toURL();
    const shown: Shown = {
      participantId: trackInfo.participant_id,
      slot: slotOf(trackName),
      track,
      stream,
      url,
    };
    this.shown.set(trackName, shown);
    console.log(`[Voice] Remote video ${trackName}`);
    registerRenderStream(url, stream as unknown as MediaStream);
    if (this.subscribed) setVideo(shown.participantId, shown.slot, url);
  }

  /** Drops every rendered stream (the media is going away). */
  clearStreams(): void {
    for (const trackName of [...this.shown.keys()]) this.hide(trackName);
  }

  clear(): void {
    this.offered.clear();
    this.clearStreams();
  }

  private hide(trackName: string): void {
    const shown = this.shown.get(trackName);
    if (!shown) return;
    this.shown.delete(trackName);
    unregisterRenderStream(shown.url);
    // The wrapper only: the media manager owns and stops the track itself.
    shown.stream.release(false);
    setVideo(shown.participantId, shown.slot, null);
  }
}
