import { createFileRoute } from "@tanstack/react-router";

import { socketTicketRoutes } from "@/server/routes/socket-ticket";

// Only referenced inside `server`, so the client build drops the import.
export const Route = createFileRoute("/api/voice/socket-ticket" as never)({
  server: {
    handlers: socketTicketRoutes(),
  },
});
