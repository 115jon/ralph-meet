// The web client's publications as the @ralph/voice reconciler sees them:
// SFUClient (PartyTracks) under the "cam" prefix for the microphone and
// camera, and the "screen" prefix for a screen share. Only the reconciler
// calls these; see packages/voice/STATE_MACHINE.md, "Publication", and
// SCREEN_SHARE.md.

import {
  PublicationReconciler,
  type PublicationMedia,
  type PublicationSlot,
  type PublicationValue,
  type ScreenPublication,
  type TrackSlot,
} from "@ralph/voice";
import { clog } from "@/lib/console-logger";
import type { SFUClient } from "@/lib/sfu-client";

const log = clog("Voice:Publication");

type PublishingClient = Pick<
  SFUClient,
  | "getMicrophoneTrackName"
  | "getPublishedTrack"
  | "publishTracks"
  | "replaceTrack"
  | "setPublishedTrackEnabled"
  | "stopTracks"
  | "unpublishTrack"
>;

/**
 * `participantId` is read at each operation: a server restart gives the
 * session a new participant id, and so new track names.
 */
export function createSfuPublicationMedia(
  sfu: PublishingClient,
  participantId: () => string,
): PublicationMedia<MediaStreamTrack> {
  const trackName = (slot: TrackSlot): string =>
    slot === "microphone"
      ? (sfu.getMicrophoneTrackName() ?? `cam-audio-${participantId()}`)
      : `cam-video-${participantId()}`;
  const screenVideo = () => `screen-video-${participantId()}`;
  const screenAudio = () => `screen-audio-${participantId()}`;

  const publishScreen = async (
    share: ScreenPublication<MediaStreamTrack>,
  ): Promise<void> => {
    // A native share is on the wire through its own pipeline.
    if (share.kind === "native") return;
    const tracks = [share.audio, share.video].filter(
      (track): track is MediaStreamTrack =>
        !!track && track.readyState !== "ended",
    );
    if (tracks.length === 0) return;
    // A published (or withdrawn and kept-alive) share has its source
    // swapped; see PartyTracksMediaManager.publishStream.
    await sfu.publishTracks(new MediaStream(tracks), "screen");
  };

  return {
    async publish(
      slot: PublicationSlot,
      value: PublicationValue<MediaStreamTrack>,
    ) {
      if (slot === "screen") {
        await publishScreen(value as ScreenPublication<MediaStreamTrack>);
        return;
      }
      // Publishing a slot that is published (or withdrawn and kept alive)
      // swaps its source; see PartyTracksMediaManager.publishStream.
      await sfu.publishTracks(
        new MediaStream([value as MediaStreamTrack]),
        "cam",
      );
    },
    async replace(
      slot: PublicationSlot,
      value: PublicationValue<MediaStreamTrack>,
    ) {
      if (slot === "screen") {
        // A share's tracks are swapped by publishing them again: a new
        // capture may add audio the old one did not have.
        await publishScreen(value as ScreenPublication<MediaStreamTrack>);
        return true;
      }
      return sfu.replaceTrack(trackName(slot), value as MediaStreamTrack);
    },
    unpublish(slot: PublicationSlot) {
      if (slot === "screen") {
        // Both names in one call, as always: StopTracks (op 13) for what
        // PartyTracks does not hold (a native share's tracks), and the
        // video kept alive for the next share (see unpublishTrack).
        sfu.stopTracks([screenVideo(), screenAudio()]);
        return;
      }
      sfu.unpublishTrack(trackName(slot));
    },
    setEnabled(slot: PublicationSlot, enabled: boolean) {
      sfu.setPublishedTrackEnabled(
        slot === "screen" ? screenAudio() : trackName(slot),
        enabled,
      );
    },
    isPublished(slot: PublicationSlot) {
      return (
        sfu.getPublishedTrack(
          slot === "screen" ? screenVideo() : trackName(slot),
        ) !== null
      );
    },
  };
}

export function createSfuPublicationReconciler(
  sfu: PublishingClient,
  participantId: () => string,
): PublicationReconciler<MediaStreamTrack> {
  return new PublicationReconciler<MediaStreamTrack>({
    media: createSfuPublicationMedia(sfu, participantId),
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    onOpError: (op, error, failures) =>
      log.warn("Publication operation failed", {
        op: op.kind,
        slot: op.slot,
        failures,
        error,
      }),
  });
}
