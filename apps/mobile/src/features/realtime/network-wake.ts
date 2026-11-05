/**
 * Turns the native network events (RalphNetwork: false when the default
 * network is lost, true when one is available) into socket wakes.
 *
 * - Back after a loss: `wake(true)`. Every socket from before is dead, so
 *   the sockets reconnect at once instead of probing.
 * - A switch with no loss in between (Wi-Fi to mobile data): `wake(false)`.
 *   The old sockets may still work, so they are probed.
 * - The loss itself does nothing: there is nothing to reach yet, and each
 *   socket's own deadlines and backoff carry it until the network is back.
 */
export function createNetworkWake(
  wake: (networkChanged: boolean) => void,
): (connected: boolean) => void {
  let lost = false;
  return (connected) => {
    if (!connected) {
      lost = true;
      return;
    }
    const networkChanged = lost;
    lost = false;
    wake(networkChanged);
  };
}
