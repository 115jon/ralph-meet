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
  resetRequests(reason: string, paths: readonly string[]): void;
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
 * The paths of the socket ticket requests: the chat gateway's and the call
 * sockets' tickets, and a call's admission.
 */
export const SOCKET_TICKET_PATHS: readonly string[] = [
  "/api/voice/socket-ticket",
  "/api/voice/admission",
];

/**
 * A socket ticket request got no answer: it went down a pooled connection
 * that may be dead, and the retry must not wait on it again. Cancels the
 * ticket requests still in flight and evicts idle pooled connections (now
 * and a moment later), so the retry opens a fresh one unless a live call
 * still holds the old one. Other calls (an upload, an image load) carry on:
 * the connection may only be slow. A real network change resets everything
 * natively.
 */
export function resetTicketRequests(reason: string): void {
  native?.resetRequests(reason, SOCKET_TICKET_PATHS);
}
