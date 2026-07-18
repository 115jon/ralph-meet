export interface WordlePuzzle {
  id: number | null;
  print_date: string;
  solution: string;
  editor: string | null;
  source: "nyt";
}

export function getNewYorkDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function parseNewYorkDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return getNewYorkDateKey(date) === value ? date : null;
}

export function getNytWordleUrl(date = new Date()) {
  return `https://www.nytimes.com/svc/wordle/v2/${getNewYorkDateKey(date)}.json`;
}

export async function fetchNytWordlePuzzle(
  date = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<WordlePuzzle> {
  const key = getNewYorkDateKey(date);
  const response = await fetcher(getNytWordleUrl(date), {
    headers: {
      Accept: "application/json",
      "User-Agent": "ralph-meet-wordle-activity/1.0",
    },
  });

  if (!response.ok) throw new Error(`NYT Wordle ${response.status}`);
  if (!response.headers.get("Content-Type")?.toLowerCase().includes("json")) {
    throw new Error("NYT Wordle returned non-JSON response");
  }

  const data = (await response.json()) as {
    id?: number;
    print_date?: string;
    solution?: string;
    editor?: string;
  };

  if (
    typeof data.solution !== "string" ||
    !/^[a-zA-Z]{5}$/.test(data.solution)
  ) {
    throw new Error("NYT Wordle payload missing valid solution");
  }
  if (data.print_date !== undefined && data.print_date !== key) {
    throw new Error("NYT Wordle payload date mismatch");
  }

  return {
    id: typeof data.id === "number" ? data.id : null,
    print_date: data.print_date ?? key,
    solution: data.solution.toLowerCase(),
    editor: data.editor ?? null,
    source: "nyt",
  };
}
