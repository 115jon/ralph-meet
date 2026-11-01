import {
  MediaStream,
  type MediaStreamTrack as NativeMediaStreamTrack,
} from "react-native-webrtc";

import type { PartyTracksMediaManager } from "./media-manager";
import type { TrackInfo } from "./protocol";
import { updateCall, type ParticipantVideo } from "./store";

// Remote camera and screen video of one call, pulled only while someone is
// watching (the call screen is up and the app is in front). The room's video
// offers are kept here, apart from audio: the media manager only ever hears
// of them while watching, and stopping them names video aliases alone, so
// audio pulls never change because of video.
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
  readonly stream: MediaStream;
}

/** A video publication the PartyTracks transport can pull. */
export function isPullableVideo(track: TrackInfo): boolean {
  return track.kind === "video" && Boolean(track.sfu_track_name);
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
  private readonly offers = new Map<string, TrackInfo>();
  private readonly shown = new Map<string, Shown>();
  private watching = false;

  constructor(private readonly media: () => PartyTracksMediaManager | null) {}

  /** What to hand the media manager now: every offer while watching. */
  pullable(): TrackInfo[] {
    return this.watching ? [...this.offers.values()] : [];
  }

  /** VoiceReady's snapshot: the room's video publications, all of them. */
  replaceOffers(tracks: readonly TrackInfo[]): void {
    this.offers.clear();
    for (const track of tracks) this.offers.set(track.track_name, track);
  }

  offer(track: TrackInfo): void {
    this.offers.set(track.track_name, track);
    if (this.watching) this.media()?.offerTracks([track]);
  }

  /** StopTracks: the session stops the pulls; this forgets the offers. */
  forget(trackNames: readonly string[]): void {
    for (const trackName of trackNames) this.offers.delete(trackName);
  }

  forgetParticipant(participantId: string): void {
    for (const [trackName, track] of this.offers) {
      if (track.participant_id === participantId) this.offers.delete(trackName);
    }
  }

  setWatching(watching: boolean): void {
    if (watching === this.watching) return;
    this.watching = watching;
    const media = this.media();
    if (watching) {
      if (this.offers.size > 0) media?.offerTracks([...this.offers.values()]);
      return;
    }
    // Only video aliases: the manager's audio pulls stay as they are.
    media?.stopRemoteTracks([...this.offers.keys()]);
    this.clearStreams();
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
    this.hide(trackName);
    // react-native-webrtc's tracks are what the DOM types call MediaStreamTrack.
    const stream = new MediaStream([
      track as unknown as NativeMediaStreamTrack,
    ]);
    const shown: Shown = {
      participantId: trackInfo.participant_id,
      slot: slotOf(trackName),
      track,
      stream,
    };
    this.shown.set(trackName, shown);
    setVideo(shown.participantId, shown.slot, stream.toURL());
  }

  /** Drops every rendered stream (the media is going away). */
  clearStreams(): void {
    for (const trackName of [...this.shown.keys()]) this.hide(trackName);
  }

  clear(): void {
    this.offers.clear();
    this.clearStreams();
  }

  private hide(trackName: string): void {
    const shown = this.shown.get(trackName);
    if (!shown) return;
    this.shown.delete(trackName);
    // The wrapper only: the media manager owns and stops the track itself.
    shown.stream.release(false);
    setVideo(shown.participantId, shown.slot, null);
  }
}
