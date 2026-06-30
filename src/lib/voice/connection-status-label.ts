type ConnectionStatusTone = "good" | "pending" | "bad";

export function getConnectionStatusBadge({
  joined,
  connectionState,
}: {
  joined: boolean;
  connectionState: string;
}): { label: string; tone: ConnectionStatusTone } {
  if (!joined) return { label: "Connecting", tone: "pending" };

  switch (connectionState) {
    case "connected":
      return { label: "Connected", tone: "good" };
    case "connecting":
    case "new":
      return { label: "Connecting", tone: "pending" };
    case "reconnecting":
    case "disconnected":
      return { label: "Reconnecting", tone: "pending" };
    default:
      return { label: "Connection issue", tone: "bad" };
  }
}
