import {
  addListenTogetherQueryHistory,
  clampListenTogetherPaneRatio,
} from "@/lib/listen-together-local";
import { describe, expect, it } from "vitest";

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
});
