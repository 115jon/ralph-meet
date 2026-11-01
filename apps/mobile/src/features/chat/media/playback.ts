import { useEffect } from "react";
import { create } from "zustand";

// Who may play right now. Silent loops queue for a few slots, first come
// first served, so a screen of GIFs cannot pull a dozen videos at once; a
// video with sound is one at a time, and starting one stops the last.

/** Silent loops decoding at once; the rest wait on their posters. */
const MAX_LOOPS = 3;

interface PlaybackState {
  readonly loops: readonly string[];
  readonly video: string | null;
}

const usePlayback = create<PlaybackState>()(() => ({ loops: [], video: null }));

/**
 * Queues the loop `id` while `wanted` (on screen, app in front) and answers
 * whether it holds one of the slots.
 */
export function useLoopSlot(id: string, wanted: boolean): boolean {
  useEffect(() => {
    if (!wanted) return;
    usePlayback.setState((s) => ({ loops: [...s.loops, id] }));
    return () =>
      usePlayback.setState((s) => ({
        loops: s.loops.filter((loop) => loop !== id),
      }));
  }, [id, wanted]);
  return usePlayback((s) => {
    const index = s.loops.indexOf(id);
    return index >= 0 && index < MAX_LOOPS;
  });
}

/** Gives `id` the one sound slot, which stops whatever had it. */
export function playVideo(id: string): void {
  usePlayback.setState({ video: id });
}

export function stopVideo(id: string): void {
  if (usePlayback.getState().video === id) {
    usePlayback.setState({ video: null });
  }
}

export function useIsPlayingVideo(id: string): boolean {
  return usePlayback((s) => s.video === id);
}
