import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbedInfo } from "@/lib/types";
import {
  hasLegacyTombstone,
  requestEmbedHeal,
  resetEmbedHeal,
} from "../embed-heal";

const tombstone: EmbedInfo = {
  id: "t",
  url: "https://www.tiktok.com/@a/video/1",
  type: "rich",
  unavailable: true,
  provider: { name: "TikTok" },
  fields: [],
};

afterEach(() => {
  resetEmbedHeal();
  vi.useRealTimers();
});

describe("embed heal", () => {
  it("only picks TikTok tombstones written before checkedAt existed", () => {
    expect(hasLegacyTombstone([tombstone])).toBe(true);
    expect(
      hasLegacyTombstone([{ ...tombstone, checkedAt: "2026-11-01T00:00:00Z" }]),
    ).toBe(false);
    expect(
      hasLegacyTombstone([
        {
          ...tombstone,
          url: "https://x.com/a/status/1",
          provider: { name: "X" },
        },
      ]),
    ).toBe(false);
    expect(hasLegacyTombstone([{ ...tombstone, unavailable: undefined }])).toBe(
      false,
    );
  });

  it("asks once per message per session, batched per channel", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});

    expect(requestEmbedHeal("c1", "m1", send)).toBe(true);
    expect(requestEmbedHeal("c1", "m1", send)).toBe(false);
    requestEmbedHeal("c1", "m2", send);
    requestEmbedHeal("c2", "m3", send);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith("c1", ["m1", "m2"]);
    expect(send).toHaveBeenCalledWith("c2", ["m3"]);

    // A remount later in the session does not ask again.
    expect(requestEmbedHeal("c1", "m1", send)).toBe(false);
  });

  it("stops after thirty messages in a session", () => {
    const send = vi.fn(async () => {});
    for (let index = 0; index < 30; index += 1) {
      expect(requestEmbedHeal("c", `m${index}`, send)).toBe(true);
    }
    expect(requestEmbedHeal("c", "m30", send)).toBe(false);
  });
});
