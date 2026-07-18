import { afterEach, describe, expect, it, vi } from "vitest";

import { getNewYorkDateKey } from "@/lib/wordle";
import { wordleTodayGet } from "../wordle/today";

describe("Wordle today route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["2026-02-30", "20260609", "not-a-date", "2026-1-09"])(
    "rejects malformed date %s clearly",
    async (date) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);

      const response = await wordleTodayGet({
        request: new Request(`https://meet.test/api/wordle/today?date=${date}`),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("YYYY-MM-DD"),
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("fetches the exact requested New York calendar puzzle", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 4552,
          print_date: "2026-06-09",
          solution: "WHARF",
          editor: "Test editor",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    const response = await wordleTodayGet({
      request: new Request(
        "https://meet.test/api/wordle/today?date=2026-06-09",
      ),
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.nytimes.com/svc/wordle/v2/2026-06-09.json",
      expect.anything(),
    );
    await expect(response.json()).resolves.toMatchObject({
      print_date: "2026-06-09",
      solution: "wharf",
      source: "nyt",
    });
  });

  it("keeps no-query requests on the current New York date", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ solution: "WHARF" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await wordleTodayGet({
      request: new Request("https://meet.test/api/wordle/today"),
    });

    expect(fetcher).toHaveBeenCalledWith(
      `https://www.nytimes.com/svc/wordle/v2/${getNewYorkDateKey(new Date())}.json`,
      expect.anything(),
    );
  });
});
