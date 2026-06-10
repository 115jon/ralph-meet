import { createFileRoute } from "@tanstack/react-router";
import { fetchNytWordlePuzzle } from "@/lib/wordle";

const GET = async () => {
  try {
    return Response.json(await fetchNytWordlePuzzle(), {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load today's Wordle" }, { status: 502 });
  }
};

export const Route = createFileRoute("/api/wordle/today")({
  server: {
    handlers: {
      GET,
    },
  },
});
