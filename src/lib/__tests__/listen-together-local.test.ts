import {
  addListenTogetherQueryHistory,
  clampListenTogetherPaneRatio,
  readListenTogetherQueryHistory,
} from "@/lib/listen-together-local";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Listen Together local workspace helpers", () => {
  it("keeps only search queries, deduplicates them, and bounds the history", () => {
    const history = addListenTogetherQueryHistory(
      ["Older", "Mixtape"],
      " older ",
    );

    expect(history).toEqual(["older", "Mixtape"]);
    expect(
      addListenTogetherQueryHistory(history, "https://youtu.be/video-1"),
    ).toEqual(history);
  });

  it("clamps malformed pane ratios to the desktop range", () => {
    expect(clampListenTogetherPaneRatio(Number.NaN)).toBe(0.28);
    expect(clampListenTogetherPaneRatio(0.9)).toBe(0.52);
    expect(clampListenTogetherPaneRatio(0.4)).toBe(0.4);
  });

  describe("stored query history", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function readStored(raw: string | null) {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => raw },
      });
      return readListenTogetherQueryHistory();
    }

    it("keeps trimmed, non-blank strings in order and bounds the list", () => {
      const many = Array.from({ length: 30 }, (_, index) => `query ${index}`);

      expect(
        readStored(JSON.stringify([" first ", "", "  ", 3, null, "second"])),
      ).toEqual(["first", "second"]);
      expect(readStored(JSON.stringify(many)).length).toBeLessThan(30);
    });

    it.each([null, "", "{oops", "null", '{"a":1}', '"text"', "3"])(
      "is empty when the stored text is %j",
      (raw) => {
        expect(readStored(raw)).toEqual([]);
      },
    );

    it("is empty when storage throws", () => {
      vi.stubGlobal("window", {
        localStorage: {
          getItem: () => {
            throw new Error("blocked");
          },
        },
      });

      expect(readListenTogetherQueryHistory()).toEqual([]);
    });
  });
});
