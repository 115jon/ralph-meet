import { describe, expect, it } from "vitest";
import {
  getHardModeViolation,
  getCompletionStatus,
  getHintDetails,
  getRevealDuration,
  shouldShowCompletionResult,
} from "./wordle-game";

describe("Wordle game behavior", () => {
  it("keeps a solved whole-word guess in the reveal phase before completion", () => {
    expect(getCompletionStatus(["crane"], "crane")).toEqual({
      status: "solved",
      finalGuessIndex: 0,
    });
    expect(getRevealDuration()).toBeGreaterThanOrEqual(1100);
  });

  it("marks a six-guess round as missed when no guess matches", () => {
    expect(
      getCompletionStatus(
        ["adore", "baker", "cabin", "dairy", "eager", "fable"],
        "crane",
      ),
    ).toEqual({ status: "missed", finalGuessIndex: 5 });
  });

  it("returns progressive clues without revealing the answer immediately", () => {
    expect(getHintDetails("crane", 1)).toMatchObject({
      kind: "first-letter",
      value: "C",
    });
    expect(getHintDetails("crane", 2)).toMatchObject({
      kind: "vowels",
      value: "2",
    });
    expect(getHintDetails("crane", 3)).toMatchObject({
      kind: "position",
      value: "R",
      position: 2,
    });
    expect(getHintDetails("crane", 4)).toBeNull();
  });

  it("keeps the puzzle board visible while the final row is revealing", () => {
    expect(
      shouldShowCompletionResult({ status: "solved", revealing: true }),
    ).toBe(false);
    expect(
      shouldShowCompletionResult({ status: "solved", revealing: false }),
    ).toBe(true);
  });

  it("requires the full revealed count for repeated hard-mode letters", () => {
    expect(getHardModeViolation("abcde", ["iaixx"], "civic")).toBe(
      "I must be used 2 times.",
    );
  });
});
