/**
 * One mapping from the voice connection state to what the headers show
 * (design-system 14.4, audit VC-24). The state decides, never `joined`
 * alone: a joined session that drops reads "Reconnecting…", not a stale
 * "Stable".
 *
 *   good     connected                  muted ink
 *   pending  new / connecting           muted ink
 *   warning  reconnecting / disconnected warning ink + icon
 *   danger   failed / closed / unknown  danger ink + icon
 */
export type ConnectionTone = "good" | "pending" | "warning" | "danger";

export interface ConnectionStatus {
  label: string;
  tone: ConnectionTone;
}

export function connectionStatus(
  connectionState: string | null | undefined,
  joined: boolean,
): ConnectionStatus {
  switch (connectionState) {
    case "connected":
      return { label: "Connected", tone: "good" };
    case "":
    case null:
    case undefined:
    case "new":
    case "connecting":
      return { label: "Connecting…", tone: "pending" };
    case "reconnecting":
      return { label: "Reconnecting…", tone: "warning" };
    case "disconnected":
      // After a deliberate leave the view is gone; while joined it is a drop.
      return joined
        ? { label: "Reconnecting…", tone: "warning" }
        : { label: "Disconnected", tone: "pending" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "closed":
      return { label: "Disconnected", tone: "danger" };
    default:
      return { label: "Connection issue", tone: "danger" };
  }
}
