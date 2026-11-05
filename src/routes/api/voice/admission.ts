import { createFileRoute } from "@tanstack/react-router";

import { voiceAdmissionRoutes } from "@/server/routes/voice-admission";

// Only referenced inside `server`, so the client build drops the import.
export const Route = createFileRoute("/api/voice/admission" as never)({
  server: {
    handlers: voiceAdmissionRoutes(),
  },
});
