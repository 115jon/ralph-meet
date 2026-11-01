import { describe, expect, it } from "vitest";

import { insertAt } from "../text-insert";
import {
  customToken,
  emojiCategories,
  emojiLabel,
  glyphFor,
  parseCustomToken,
  searchEmojis,
} from "./emoji-data";
import { gridColumns, layoutGrid, sectionAt, type GridSection } from "./grid";
import { framesBetween, layoutMasonry } from "./masonry";
import { DEFAULT_REACTIONS, quickReactions, withRecent } from "./recent-list";

describe("emoji data", () => {
  it("builds the eight Unicode categories with tones where they apply", () => {
    const categories = emojiCategories();
    expect(categories.map((category) => category.id)).toEqual([
      "people",
      "nature",
      "foods",
      "activity",
      "places",
      "objects",
      "symbols",
      "flags",
    ]);
    expect(categories[0]?.label).toBe("Smileys & people");
    const thumbs = categories[0]?.emojis.find((emoji) => emoji.id === "+1");
    expect(thumbs?.skins).toHaveLength(6);
    expect(thumbs && glyphFor(thumbs, 3)).toBe("👍🏽");
    const fire = categories
      .flatMap((category) => category.emojis)
      .find((emoji) => emoji.id === "fire");
    // No tones: any tone falls back to the one glyph.
    expect(fire && glyphFor(fire, 5)).toBe("🔥");
  });

  it("ranks an exact id first and needs every term to match", () => {
    expect(searchEmojis("fire")[0]?.id).toBe("fire");
    expect(searchEmojis("thumbs up")[0]?.id).toBe("+1");
    expect(searchEmojis("fire zzzz")).toEqual([]);
    expect(searchEmojis("   ")).toEqual([]);
  });

  it("reads and writes the web's custom emoji token", () => {
    expect(customToken("Happy Goat!", "abc-1")).toBe("<:happy_goat:abc-1>");
    expect(parseCustomToken("<:goat:abc-1>")).toEqual({
      name: "goat",
      id: "abc-1",
    });
    expect(parseCustomToken("🔥")).toBeNull();
    expect(emojiLabel("<:goat:abc-1>")).toBe(":goat:");
    expect(emojiLabel("👍🏽")).toBe("Thumbs Up");
  });
});

describe("emoji grid layout", () => {
  const cell = (n: number) => ({ key: `k${n}`, value: `v${n}`, label: "" });
  const sections: GridSection[] = [
    { id: "recent", label: "Recently used", cells: [cell(1), cell(2)] },
    { id: "creations", label: "Your creations", cells: [] },
    {
      id: "people",
      label: "People",
      cells: Array.from({ length: 10 }, (_, i) => cell(i + 10)),
    },
  ];

  it("lays sections out as a label row and rows of whole cells", () => {
    const layout = layoutGrid(sections, 4, 40, 30);
    expect(layout.rows.map((row) => row.kind)).toEqual([
      "label",
      "cells",
      "label",
      "cells",
      "cells",
      "cells",
    ]);
    // An empty section takes no room and gets no rail key.
    expect([...layout.sectionTops.keys()]).toEqual(["recent", "people"]);
    expect(layout.sectionTops.get("people")).toBe(70);
    expect(layout.offsets).toEqual([0, 30, 70, 100, 140, 180]);
  });

  it("names the section at the top of the viewport", () => {
    const layout = layoutGrid(sections, 4, 40, 30);
    expect(sectionAt(layout, 0)).toBe("recent");
    expect(sectionAt(layout, 69)).toBe("people");
    expect(sectionAt(layout, 500)).toBe("people");
    expect(sectionAt(layoutGrid([], 4, 40, 30), 0)).toBeNull();
  });

  it("fits whole cells across the width", () => {
    expect(gridColumns(360, 44)).toBe(8);
    expect(gridColumns(20, 44)).toBe(1);
  });
});

describe("masonry", () => {
  it("drops each tile into the shortest column", () => {
    const { frames, height } = layoutMasonry([1, 0.5, 1, 1], 206, 2, 6);
    expect(frames.map((frame) => [frame.x, frame.y])).toEqual([
      [0, 0],
      [106, 0],
      [0, 106],
      [106, 206],
    ]);
    expect(frames[1]?.height).toBe(200);
    expect(height).toBe(306);
  });

  it("clamps odd aspect ratios and finds the frames in a band", () => {
    const { frames } = layoutMasonry([100, 0, Number.NaN], 100, 1, 0);
    expect(frames.map((frame) => frame.height)).toEqual([42, 100, 100]);
    expect(framesBetween(frames, 50, 150)).toEqual([1, 2]);
  });
});

describe("recents", () => {
  it("keeps one copy, newest first, 36 at most", () => {
    expect(withRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    const many = Array.from({ length: 40 }, (_, i) => String(i));
    expect(withRecent(many, "x")).toHaveLength(36);
  });

  it("tops the quick row up from the defaults", () => {
    expect(quickReactions([])).toEqual(DEFAULT_REACTIONS);
    expect(quickReactions(["🐐", "🔥"])).toEqual([
      "🐐",
      "🔥",
      "😂",
      "💀",
      "👍",
    ]);
  });
});

describe("insertAt", () => {
  it("types over the selection and moves the caret after it", () => {
    expect(insertAt("bet ", { start: 4, end: 4 }, "🐐")).toEqual({
      text: "bet 🐐",
      cursor: 6,
    });
    expect(insertAt("hello world", { start: 6, end: 11 }, "😂")).toEqual({
      text: "hello 😂",
      cursor: 8,
    });
    expect(insertAt("hi", { start: 9, end: 9 }, "!")).toEqual({
      text: "hi!",
      cursor: 3,
    });
  });
});
