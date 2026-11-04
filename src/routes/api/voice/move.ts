import { createFileRoute } from "@tanstack/react-router";

import { voiceMoveRoutes } from "@/server/routes/voice-move";

// Only referenced inside `server`, so the client build drops the import.
export const Route = createFileRoute("/api/voice/move" as never)({
  server: {
    handlers: voiceMoveRoutes(),
  },
});
