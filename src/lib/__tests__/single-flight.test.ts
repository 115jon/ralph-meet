import { describe, expect, it } from "vitest";
import { singleFlight } from "../single-flight";

describe("singleFlight", () => {
  it("reuses one in-flight promise for the same key", async () => {
    const flights = new Map<string, Promise<number>>();
    let runs = 0;
    let release!: (value: number) => void;
    const gate = new Promise<number>((resolve) => {
      release = resolve;
    });

    const run = () => {
      runs += 1;
      return gate;
    };

    const first = singleFlight(flights, "post:1", run);
    const second = singleFlight(flights, "post:1", run);

    expect(runs).toBe(1);
    release(7);
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
  });
});
