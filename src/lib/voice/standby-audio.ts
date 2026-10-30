export interface SilentAudioTrack {
  stream: MediaStream;
  track: MediaStreamTrack;
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
