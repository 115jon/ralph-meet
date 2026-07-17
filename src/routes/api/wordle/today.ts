import { createFileRoute } from "@tanstack/react-router";
import { fetchNytWordlePuzzle, parseNewYorkDateKey } from "@/lib/wordle";

export const wordleTodayGet = async ({ request }: { request: Request }) => {
  try {
    const searchParams = new URL(request.url).searchParams;
    const dates = searchParams.getAll("date");
    if (dates.length > 1) {
      return Response.json(
        { error: "Invalid date; expected YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const requestedDate = dates[0];
    if (requestedDate !== undefined) {
      const date = parseNewYorkDateKey(requestedDate);
      if (!date) {
        return Response.json(
          { error: "Invalid date; expected YYYY-MM-DD" },
          { status: 400 },
        );
      }
      return Response.json(await fetchNytWordlePuzzle(date), {
        headers: {
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    return Response.json(await fetchNytWordlePuzzle(), {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load today's Wordle",
      },
      { status: 502 },
    );
  }
};

export const Route = createFileRoute("/api/wordle/today")({
  server: {
    handlers: {
      GET: wordleTodayGet,
    },
  },
});
