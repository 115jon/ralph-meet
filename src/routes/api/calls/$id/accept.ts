import { createFileRoute } from "@tanstack/react-router";

import { callAnswerRoutes } from "@/server/routes/calls";

// Only referenced inside `server`, so the client build drops the import.
export const Route = createFileRoute("/api/calls/$id/accept")({
  server: {
    handlers: callAnswerRoutes("accept"),
  },
});
