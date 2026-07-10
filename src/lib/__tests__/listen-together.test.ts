import {
  getListenTogetherInputMode,
  isListenTogetherResolvableUrl,
  isValidListenTogetherVideoId,
} from "@/lib/listen-together";
import { describe, expect, it } from "vitest";

describe("listen together helpers", () => {
  it("accepts standard YouTube video ids", () => {
    expect(isValidListenTogetherVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidListenTogetherVideoId("abc123XYZ_-")).toBe(true);
  });

  it("rejects malformed video ids", () => {
    expect(isValidListenTogetherVideoId("bad id")).toBe(false);
    expect(isValidListenTogetherVideoId("a")).toBe(false);
    expect(isValidListenTogetherVideoId("%%%%%%")).toBe(false);
  });

  it("detects supported listen together resolver URLs", () => {
    expect(isListenTogetherResolvableUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      true,
    );
    expect(
      isListenTogetherResolvableUrl(
        "https://open.spotify.com/track/3rdhviQpre30wOnZuE3oWu",
      ),
    ).toBe(true);
    expect(isListenTogetherResolvableUrl("not a url")).toBe(false);
  });

  it("classifies shared input mode for empty, search, and resolver values", () => {
    expect(getListenTogetherInputMode("")).toBe("empty");
    expect(getListenTogetherInputMode("oui")).toBe("search");
    expect(
      getListenTogetherInputMode(
        "https://music.youtube.com/watch?v=abc123XYZ90",
      ),
    ).toBe("resolve");
  });
});
