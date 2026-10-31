import { createFileRoute } from "@tanstack/react-router";

import { GET } from "@/lib/voice/soundboard-upload-handler";

export const Route = createFileRoute("/api/soundboard/uploads/$id")({
  server: {
    handlers: {
      GET,
    },
  },
});
