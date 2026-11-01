import { create } from "zustand";

// The pixel size each video stream is drawn at (RTCView's dimension events),
// so the PiP window can take the shape of what it shows.

export interface VideoSize {
  readonly width: number;
  readonly height: number;
}

const useVideoSizes = create<Readonly<Record<string, VideoSize>>>()(() => ({}));

export function setVideoSize(streamURL: string, size: VideoSize): void {
  const current = useVideoSizes.getState()[streamURL];
  if (current?.width === size.width && current.height === size.height) return;
  useVideoSizes.setState({ [streamURL]: size });
}

export function useVideoSize(streamURL: string | null): VideoSize | null {
  return useVideoSizes((s) => (streamURL ? (s[streamURL] ?? null) : null));
}
