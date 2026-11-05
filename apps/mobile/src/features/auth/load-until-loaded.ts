/**
 * Runs `load` now and, until one run succeeds, again each time the network
 * comes back (`onNetworkBack`). An app launched offline would otherwise
 * never load its profile, and with no profile the chat socket never starts.
 * Returns the stop.
 */
export function loadUntilLoaded<T>(
  load: () => Promise<T>,
  loaded: (value: T) => void,
  onNetworkBack: (listener: () => void) => () => void,
): () => void {
  let live = true;
  let done = false;
  const run = () => {
    if (done) return;
    load().then(
      (value) => {
        if (!live || done) return;
        done = true;
        stopListening();
        loaded(value);
      },
      () => {
        // Offline or a server error: the next network return tries again.
      },
    );
  };
  const stopListening = onNetworkBack(run);
  run();
  return () => {
    live = false;
    stopListening();
  };
}
