function hasLiveTrack(tracks: MediaStreamTrack[] | undefined): boolean {
  return tracks?.some((track) => track.readyState === "live") ?? false;
}

export function hasLiveAudioTrack(stream: MediaStream | null | undefined) {
  return hasLiveTrack(stream?.getAudioTracks?.());
}

/**
 * Whether a tile has video to show. A remote share's stream can hold only
 * its audio (video is pulled only while watched, and a watched share's video
 * arrives after its audio), and a camera tile's stream holds the microphone
 * too, so a stream alone would render a black <video>.
 */
export function hasLiveVideoTrack(stream: MediaStream | null | undefined) {
  return hasLiveTrack(stream?.getVideoTracks?.());
}
