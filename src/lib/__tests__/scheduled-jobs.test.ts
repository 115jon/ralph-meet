import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runScheduledJobs,
  selectScheduledJobs,
  type ScheduledJob,
} from "@/lib/scheduled-jobs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runScheduledJobs", () => {
  it("isolates a throwing job from the others", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let slowFinished = false;
    const waited: Promise<unknown>[] = [];
    const jobs: ScheduledJob[] = [
      {
        name: "Collectibles catalog sync",
        run: async () => {
          throw new Error("Yapper catalog fetch failed with 403");
        },
      },
      {
        name: "R2 cleanup retry",
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          slowFinished = true;
        },
      },
    ];

    const results = await runScheduledJobs(jobs, (promise) =>
      waited.push(promise),
    );

    expect(waited).toHaveLength(2);
    // Nothing handed to waitUntil may reject, or it settles the invocation.
    await expect(Promise.all(waited)).resolves.toBeTruthy();
    expect(slowFinished).toBe(true);
    expect(results.map((result) => result.ok)).toEqual([false, true]);
    expect(results[0].error).toBe("Yapper catalog fetch failed with 403");
    expect(errors).toHaveBeenCalledWith(
      "Collectibles catalog sync failed: Yapper catalog fetch failed with 403",
    );
  });
});

describe("selectScheduledJobs", () => {
  const job = (name: string): ScheduledJob => ({ name, run: async () => {} });
  const groups = {
    maintenance: { crons: ["0 */6 * * *"], jobs: [job("a"), job("b")] },
    collectibles: { crons: ["17 * * * *"], jobs: [job("c")] },
  };

  it("runs only the jobs for the firing cron", () => {
    expect(
      selectScheduledJobs("17 * * * *", groups).map((entry) => entry.name),
    ).toEqual(["c"]);
    expect(
      selectScheduledJobs("0 */6 * * *", groups).map((entry) => entry.name),
    ).toEqual(["a", "b"]);
  });

  it("runs everything for an unknown cron", () => {
    expect(
      selectScheduledJobs("*/5 * * * *", groups).map((entry) => entry.name),
    ).toEqual(["a", "b", "c"]);
  });
});
