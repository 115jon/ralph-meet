// The web client's publications as the @ralph/voice reconciler sees them:
// SFUClient (PartyTracks) under the "cam" prefix. Only the reconciler calls
// these; see packages/voice/STATE_MACHINE.md, "Publication".

import {
  PublicationReconciler,
  type PublicationMedia,
  type PublicationSlot,
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
  const trackName = (slot: PublicationSlot): string =>
    slot === "microphone"
      ? (sfu.getMicrophoneTrackName() ?? `cam-audio-${participantId()}`)
      : `cam-video-${participantId()}`;
  return {
    async publish(_slot, track) {
      // Publishing a slot that is published (or withdrawn and kept alive)
      // swaps its source; see PartyTracksMediaManager.publishStream.
      await sfu.publishTracks(new MediaStream([track]), "cam");
    },
    replace(slot, track) {
      return sfu.replaceTrack(trackName(slot), track);
    },
    unpublish(slot) {
      sfu.unpublishTrack(trackName(slot));
    },
    setEnabled(slot, enabled) {
      sfu.setPublishedTrackEnabled(trackName(slot), enabled);
    },
    isPublished(slot) {
      return sfu.getPublishedTrack(trackName(slot)) !== null;
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
