import { describe, expect, it } from "vitest";

import { canPrefetch, chunksToPrefetch, groupsForPath } from "@/lib/prefetch";

describe("groupsForPath", () => {
  it("sends a signed-out landing visitor to sign-in or a room", () => {
    expect(groupsForPath("/", false)).toEqual(["sign-in", "room"]);
  });

  it("sends a returning visitor straight to the chat shell", () => {
    expect(groupsForPath("/", true)).toEqual(["chat"]);
  });

  it("warms the chat shell behind the sign-in and sign-up cards", () => {
    expect(groupsForPath("/sign-in", false)).toEqual(["chat"]);
    expect(groupsForPath("/sign-up", false)).toEqual(["chat"]);
  });

  it("warms the call stack in a room lobby", () => {
    expect(groupsForPath("/room/standup", false)).toEqual(["room-voice"]);
  });

  it("only sends a signed-out activation page to sign-in", () => {
    expect(groupsForPath("/activate", false)).toEqual(["sign-in"]);
    expect(groupsForPath("/activate", true)).toEqual([]);
  });

  it("prefetches nothing for the chat shell itself or unknown paths", () => {
    expect(groupsForPath("/chat", true)).toEqual([]);
    expect(groupsForPath("/share/abc", false)).toEqual([]);
  });
});

describe("canPrefetch", () => {
  it("respects Data Saver and 2G", () => {
    expect(canPrefetch({ saveData: true })).toBe(false);
    expect(canPrefetch({ effectiveType: "2g" })).toBe(false);
    expect(canPrefetch({ effectiveType: "slow-2g" })).toBe(false);
  });

  it("allows 3G and faster, or an unknown connection", () => {
    expect(canPrefetch({ effectiveType: "3g" })).toBe(true);
    expect(canPrefetch({ effectiveType: "4g" })).toBe(true);
    expect(canPrefetch(undefined)).toBe(true);
  });
});

describe("chunksToPrefetch", () => {
  const manifest = {
    chat: ["/assets/chat.js", "/assets/shared.js"],
    "sign-in": ["/assets/sign-in.js", "/assets/shared.js"],
  };

  it("lists each chunk once across groups", () => {
    expect(chunksToPrefetch(manifest, ["chat", "sign-in"], new Set())).toEqual([
      "/assets/chat.js",
      "/assets/shared.js",
      "/assets/sign-in.js",
    ]);
  });

  it("skips chunks the page already requested", () => {
    expect(
      chunksToPrefetch(manifest, ["chat"], new Set(["/assets/shared.js"])),
    ).toEqual(["/assets/chat.js"]);
  });

  it("ignores groups the build did not write", () => {
    expect(chunksToPrefetch(manifest, ["room-voice"], new Set())).toEqual([]);
  });
});
