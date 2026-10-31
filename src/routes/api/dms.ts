import { createFileRoute } from "@tanstack/react-router";

import { dmRoutes } from "@/server/routes/dms";

// Only referenced inside `server`, so the client build drops the import.
export const Route = createFileRoute("/api/dms")({
  server: {
    handlers: dmRoutes(),
  },
});
