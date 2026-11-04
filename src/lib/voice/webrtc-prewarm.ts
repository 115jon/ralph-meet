/**
 * The first RTCPeerConnection a renderer creates starts the browser's WebRTC
 * stack, and the constructor blocks the main thread while it does: 130–200 ms
 * measured in production, 475 ms on a dev machine. Made during a join (when
 * PartyTracks gets its session), that stall holds up the room socket's open
 * event, Identify and the first render of the call. Later connections cost
 * about a millisecond.
 *
 * So when the user shows they are about to join (a voice landing is open,
 * the pointer is on a voice channel), build and close one connection while
 * the page is idle. It has no configuration and never gathers candidates, so
 * it touches no network.
 */
let prewarmed = false;

type IdleScheduler = (callback: () => void) => void;

const scheduleIdle: IdleScheduler = (callback) => {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout: 1_000 });
  } else {
    setTimeout(callback, 0);
  }
};

export function prewarmWebRtc(schedule: IdleScheduler = scheduleIdle): void {
  if (prewarmed || typeof RTCPeerConnection === "undefined") return;
  prewarmed = true;
  schedule(() => {
    try {
      new RTCPeerConnection().close();
    } catch {
      // Blocked or unsupported here: the join creates its own anyway.
    }
  });
}

export function resetWebRtcPrewarmForTests(): void {
  prewarmed = false;
}
