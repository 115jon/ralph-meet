import { readReceiverFrames, type VideoFrameReading } from "@ralph/voice-media";

/** The StatsHub's last reading of a pulled video alias (ConnectionStatsMonitor). */
export interface HubTrackFrames {
  readonly frames: number;
  readonly timestamp: number;
}

/**
 * A camera pulled on the call's session: its decoded frames, from the
 * StatsHub's latest snapshot when the hub has one for this track, so the
 * hub stays the one getStats() poller there.
 *
 * The hub matches inbound-rtp to a track by trackIdentifier, which Firefox
 * before 111 and Safari before 16.4 leave out, and an entry older than this
 * track (`since`, when it was first read) is its alias's previous track's.
 * With no entry of its own, the track's receiver is read directly: zero
 * frames until something arrives, rather than a zero that a browser the hub
 * cannot match would report forever (a spurious stall, then a re-pull).
 */
export function readMainSessionVideoFrames(
  hub: HubTrackFrames | null | undefined,
  since: number,
  receiver: RTCRtpReceiver | null,
): Promise<VideoFrameReading> | VideoFrameReading | null {
  if (hub && hub.timestamp >= since) {
    return { frames: hub.frames, at: hub.timestamp };
  }
  return receiver ? readReceiverFrames(receiver) : null;
}
