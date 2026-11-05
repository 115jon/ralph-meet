import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// The HTTP client under fetch on Android (see RalphNetwork.kt): it has
// timeouts, and on a default-network change it cancels the HTTP calls in
// flight and empties its connection pool before telling JS. Elsewhere (and
// on an older build without the module) every function is a safe no-op.

interface NetworkChange {
  readonly connected: boolean;
}

interface Subscription {
  remove(): void;
}

interface RalphNetworkNative {
  isConnected(): boolean;
  resetConnections(reason: string): void;
  addListener(
    event: "onNetworkChange",
    listener: (change: NetworkChange) => void,
  ): Subscription;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<RalphNetworkNative>("RalphNetwork")
    : null;

/**
 * Calls `listener` after the default network is lost or a network comes
 * back. By then the HTTP pool has been reset, so a request made from the
 * listener opens a fresh connection.
 */
export function addNetworkChangeListener(
  listener: (connected: boolean) => void,
): () => void {
  if (!native) return () => {};
  const subscription = native.addListener("onNetworkChange", (change) =>
    listener(change.connected),
  );
  return () => subscription.remove();
}

/** False only while Android reports no default network. */
export function isConnected(): boolean {
  return native?.isConnected() ?? true;
}

/**
 * Cancels HTTP calls in flight and empties the pool: a request that stalled
 * means the pooled connection is dead, and the next one must not reuse it.
 */
export function resetConnections(reason: string): void {
  native?.resetConnections(reason);
}
