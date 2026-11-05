import { largerRenderedSize, type RenderedVideoSize } from "./video-layers";

/**
 * Where remote video is on screen and how large: video elements report the
 * stream they show and their size, and the media manager reads the largest
 * size each pulled video track is rendered at to pick its simulcast layer.
 */
export interface VideoRenderDemandSource {
  /** The largest size `track` is rendered at, or null if nothing shows it. */
  largestRenderFor(track: MediaStreamTrack): RenderedVideoSize | null;
  /** Called after any render is reported, resized or withdrawn. */
  subscribe(listener: () => void): () => void;
}

/** One rendering element's key: a fresh Symbol per mounted video. */
export type VideoRenderOwner = symbol;

interface Render {
  readonly stream: MediaStream;
  readonly size: RenderedVideoSize;
}

export class VideoRenderDemand implements VideoRenderDemandSource {
  private readonly renders = new Map<VideoRenderOwner, Render>();
  private readonly listeners = new Set<() => void>();

  /** Report again on resize; withdraw when the element goes. */
  report(
    owner: VideoRenderOwner,
    stream: MediaStream,
    size: RenderedVideoSize,
  ): void {
    const previous = this.renders.get(owner);
    if (
      previous?.stream === stream &&
      previous.size.width === size.width &&
      previous.size.height === size.height
    ) {
      return;
    }
    this.renders.set(owner, { stream, size });
    this.notify();
  }

  withdraw(owner: VideoRenderOwner): void {
    if (this.renders.delete(owner)) this.notify();
  }

  largestRenderFor(track: MediaStreamTrack): RenderedVideoSize | null {
    let largest: RenderedVideoSize | null = null;
    for (const { stream, size } of this.renders.values()) {
      if (!stream.getVideoTracks().some((shown) => shown === track)) continue;
      largest = largerRenderedSize(largest, size);
    }
    return largest;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The app's one registry: every VideoPlayer reports here. */
export const videoRenderDemand = new VideoRenderDemand();
