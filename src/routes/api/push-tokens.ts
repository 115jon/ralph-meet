import { createFileRoute } from "@tanstack/react-router";

import { pushTokenRoutes } from "@/server/routes/push-tokens";

// Only referenced inside `server`, so the client build drops the import.
export const Route = createFileRoute("/api/push-tokens")({
  server: {
    handlers: pushTokenRoutes(),
  },
});
