import { describe, expect, it } from "vitest";
import {
  createPublicationLiveness,
  PUBLICATION_STALE_AFTER_MS,
  SFU_TRACK_INACTIVITY_GC_MS,
} from "../publication-liveness";

describe("publication liveness", () => {
  it("is never stale while media flows", () => {
    let now = 0;
    const liveness = createPublicationLiveness(() => now);
    now = 10 * SFU_TRACK_INACTIVITY_GC_MS;
    expect(liveness.idleMs()).toBe(0);
    expect(liveness.isStale()).toBe(false);
  });

  it("goes stale with a margin before the SFU drops a silent track", () => {
    expect(PUBLICATION_STALE_AFTER_MS).toBeLessThan(SFU_TRACK_INACTIVITY_GC_MS);
    let now = 1_000;
    const liveness = createPublicationLiveness(() => now);
    liveness.markIdle();
    now += PUBLICATION_STALE_AFTER_MS - 1;
    expect(liveness.isStale()).toBe(false);
    now += 1;
    expect(liveness.isStale()).toBe(true);
    expect(liveness.idleMs()).toBe(PUBLICATION_STALE_AFTER_MS);
  });

  it("counts from the first idle mark, not a repeated one", () => {
    let now = 0;
    const liveness = createPublicationLiveness(() => now, 100);
    liveness.markIdle();
    now = 60;
    liveness.markIdle();
    now = 100;
    expect(liveness.isStale()).toBe(true);
  });

  it("flowing media resets the clock", () => {
    let now = 0;
    const liveness = createPublicationLiveness(() => now, 100);
    liveness.markIdle();
    now = 150;
    liveness.markFlowing();
    expect(liveness.isStale()).toBe(false);
    liveness.markIdle();
    now = 249;
    expect(liveness.isStale()).toBe(false);
    now = 250;
    expect(liveness.isStale()).toBe(true);
  });
});
