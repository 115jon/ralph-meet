export interface SilentAudioTrack {
  stream: MediaStream;
  track: MediaStreamTrack;
  /**
   * Stops rendering: the track stays live (the sender keeps its transceiver)
   * but no audio frames, and so no RTP, are produced. A warmed standby sits
   * paused so browsing costs no audio thread, encoder or packets. The SFU
   * drops a track without packets after 30 s, so a long pause needs a
   * republish on resume (see publication-liveness).
   */
  pause: () => void;
  /** Starts producing (silent) frames again; used the moment a join claims it. */
  resume: () => void;
  stop: () => void;
}

export function createSilentAudioTrack(): SilentAudioTrack {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    void context.close();
    throw new Error("Silent audio track unavailable");
  }
  let stopped = false;
  return {
    stream: destination.stream,
    track,
    pause: () => {
      if (stopped || context.state !== "running") return;
      void context.suspend().catch(() => undefined);
    },
    resume: () => {
      if (stopped || context.state === "running") return;
      void context.resume().catch(() => undefined);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        oscillator.stop();
      } catch {
        /* already stopped */
      }
      track.stop();
      void context.close();
    },
  };
}
