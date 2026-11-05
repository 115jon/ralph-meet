// The track and ICE shapes the media layer works in. The voice room sends
// these (VoiceReady op 101, Video op 12, StopTracks op 13); each platform
// decodes its frames and hands them over in this shape.

/** A published track as the voice room describes it. */
export interface TrackInfo {
  participant_id: string;
  /** Stable Ralph alias used by the UI (for example, cam-audio-<participant>). */
  track_name: string;
  /** Opaque PartyTracks/SFU track identifier used only at the transport boundary. */
  sfu_track_name?: string;
  session_id: string;
  mid?: string;
  kind: "audio" | "video";
  /**
   * RIDs of a simulcast publication's layers, highest first. Absent for a
   * single-layer publication (audio, screen shares, mobile cameras, older
   * clients), which is pulled without choosing a layer.
   */
  simulcast_rids?: string[];
  /** Set locally on pulled tracks; never sent. */
  track?: MediaStreamTrack;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}
