import { createFileRoute } from "@tanstack/react-router";

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function fallbackPuzzle() {
  const words = ["crane", "slate", "plant", "brave", "crown", "spice", "trace", "orbit", "frost", "gleam"];
  const day = Math.floor(Date.now() / 86_400_000);
  return {
    id: day,
    print_date: dateKey(),
    solution: words[day % words.length],
    editor: "Ralph Meet",
    source: "fallback",
  };
}

const GET = async () => {
  const key = dateKey();
  const upstream = `https://www.nytimes.com/svc/wordle/v2/${key}.json`;

  try {
    const response = await fetch(upstream, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ralph-meet-wordle-activity/1.0",
      },
    });

    if (!response.ok) throw new Error(`NYT Wordle ${response.status}`);
    const data = await response.json() as {
      id?: number;
      print_date?: string;
      solution?: string;
      editor?: string;
    };

    if (typeof data.solution !== "string" || data.solution.length !== 5) {
      throw new Error("NYT Wordle payload missing solution");
    }

    return Response.json({
      id: data.id,
      print_date: data.print_date ?? key,
      solution: data.solution.toLowerCase(),
      editor: data.editor ?? null,
      source: "nyt",
    }, {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return Response.json(fallbackPuzzle(), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }
};

export const Route = createFileRoute("/api/wordle/today")({
  server: {
    handlers: {
      GET,
    },
  },
});
