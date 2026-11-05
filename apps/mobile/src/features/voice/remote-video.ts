import type { TrackInfo } from "@ralph/voice-media";
import {
  MediaStream as NativeMediaStream,
  type MediaStreamTrack as NativeMediaStreamTrack,
} from "react-native-webrtc";

import { registerRenderStream, unregisterRenderStream } from "./render-demand";
import { updateCall, type ParticipantVideo } from "./store";

// Remote camera and screen video of one call. Video is opt-in on the media
// manager (optInTrackPrefixes): a publication is pulled only once the call
// screen watches (it is up and the app is in front, or in PiP). Once
// pulled, it stays pulled until it ends, even when the screen stops
// watching: the SFU cannot pull a closed slot again in the same session
// (it recycles the m-line under the same MID with other RTP header
// extension IDs, which libwebrtc rejects; packages/voice/SCREEN_SHARE.md,
// "Watching"). While nobody watches, nothing renders it, so a web camera
// drops to its lowest simulcast layer, and the store shows no video.
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

/** The media manager's per-alias subscription (see setRemoteTrackSubscription). */
export interface VideoSubscriber {
  setRemoteTrackSubscription(trackName: string, subscribe: boolean): void;
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
  private watching = false;

  constructor(private readonly subscriber: () => VideoSubscriber | null) {}

  get isWatching(): boolean {
    return this.watching;
  }

  /** Before the manager hears of an offered video alias. */
  noteOffer(trackName: string): void {
    if (this.offered.has(trackName)) return;
    this.offered.add(trackName);
    if (this.watching) {
      this.subscriber()?.setRemoteTrackSubscription(trackName, true);
    }
  }

  /** The alias ended (StopTracks, the participant left). */
  forget(trackName: string): void {
    this.offered.delete(trackName);
  }

  setWatching(watching: boolean): void {
    if (watching === this.watching) return;
    this.watching = watching;
    const subscriber = this.subscriber();
    for (const trackName of this.offered) {
      subscriber?.setRemoteTrackSubscription(trackName, watching);
    }
    // Kept pulls carry on; the store shows them only while watched.
    for (const shown of this.shown.values()) {
      setVideo(shown.participantId, shown.slot, watching ? shown.url : null);
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
    registerRenderStream(url, stream as unknown as MediaStream);
    if (this.watching) setVideo(shown.participantId, shown.slot, url);
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
