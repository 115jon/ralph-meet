import { describe, expect, it, vi } from "vitest";
import { fetchNytWordlePuzzle, getNewYorkDateKey, getNytWordleUrl } from "./wordle";

describe("Wordle NYT source", () => {
  it("uses the New York calendar date instead of UTC", () => {
    const date = new Date("2026-06-09T02:00:00.000Z");

    expect(getNewYorkDateKey(date)).toBe("2026-06-08");
    expect(getNytWordleUrl(date)).toBe("https://www.nytimes.com/svc/wordle/v2/2026-06-08.json");
  });

  it("normalizes a valid NYT puzzle payload", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => ({ id: 4552, solution: "WHARF", print_date: "2026-06-09", editor: "Tracy Bennett" }),
    });

    await expect(fetchNytWordlePuzzle(new Date("2026-06-09T12:00:00.000Z"), fetcher)).resolves.toEqual({
      id: 4552,
      print_date: "2026-06-09",
      solution: "wharf",
      editor: "Tracy Bennett",
      source: "nyt",
    });
  });

  it("rejects invalid upstream payloads instead of inventing a daily answer", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => ({ solution: "not-a-word" }),
    });

    await expect(fetchNytWordlePuzzle(new Date("2026-06-09T12:00:00.000Z"), fetcher)).rejects.toThrow(
      "NYT Wordle payload missing valid solution"
    );
  });

  it("rejects HTML upstream responses before parsing JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "text/html" }),
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    });

    await expect(fetchNytWordlePuzzle(new Date("2026-06-09T12:00:00.000Z"), fetcher)).rejects.toThrow(
      "NYT Wordle returned non-JSON response"
    );
  });
});
