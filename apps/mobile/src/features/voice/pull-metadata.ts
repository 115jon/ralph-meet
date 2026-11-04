import type { TrackMetadata } from "partytracks/client";

import type { TrackInfo } from "./protocol";

/**
 * What PartyTracks pulls for a remote publication. A simulcast camera (web
 * publishers send layers f, h, q, highest first) is pulled at its top
 * layer, as a phone showed every camera before the web sent layers. Naming
 * the layer matters: what the SFU forwards for a simulcast track pulled
 * without one is not specified. A single-layer track is pulled as before.
 */
export function toPartyTracksMetadata(track: TrackInfo): TrackMetadata {
  const metadata: TrackMetadata = {
    location: "remote",
    trackName: track.sfu_track_name ?? track.track_name,
    sessionId: track.session_id,
  };
  const topLayer = track.simulcast_rids?.[0];
  if (topLayer && (track.simulcast_rids?.length ?? 0) > 1) {
    metadata.simulcast = { preferredRid: topLayer };
  }
  return metadata;
}
