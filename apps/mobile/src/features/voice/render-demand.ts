import {
  videoRenderDemand,
  type VideoRenderOwner,
} from "@ralph/voice-media/video-render-demand";

// Where pulled video is on screen and how large, for the media manager's
// simulcast layer choice (@ralph/voice-media VideoRenderDemand): a full
// screen tile pulls a web camera's top layer, a grid tile a lower one, a
// camera nothing shows (the call screen hidden) the lowest. RTCView knows
// only a stream URL, so remote-video registers the stream behind each URL.
// Imports only the registry, not the media manager, so a tile can load it
// before the WebRTC runtime.

const streams = new Map<string, MediaStream>();

export function registerRenderStream(url: string, stream: MediaStream): void {
  streams.set(url, stream);
}

export function unregisterRenderStream(url: string): void {
  streams.delete(url);
}

export function newRenderOwner(): VideoRenderOwner {
  return Symbol("video-view");
}

/** `size` in device pixels; null when the view goes or shows nothing. */
export function reportRender(
  owner: VideoRenderOwner,
  url: string,
  size: { readonly width: number; readonly height: number } | null,
): void {
  const stream = streams.get(url);
  if (!stream || !size || size.width <= 0 || size.height <= 0) {
    videoRenderDemand.withdraw(owner);
    return;
  }
  videoRenderDemand.report(owner, stream, size);
}

export function withdrawRender(owner: VideoRenderOwner): void {
  videoRenderDemand.withdraw(owner);
}
