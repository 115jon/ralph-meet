import { describe, expect, it } from "vitest";

import { appPathOf, inviteLink, messageLink, parseAppLink } from "./parse";

const ORIGINS = { web: "https://web.example", scheme: "ralphmeet-dev" };

describe("parseAppLink", () => {
  it("reads a web invite", () => {
    expect(parseAppLink("https://web.example/invite/AbC123", ORIGINS)).toEqual({
      kind: "invite",
      code: "AbC123",
    });
  });

  it("reads a web message link in a server channel", () => {
    expect(
      parseAppLink(
        "https://web.example/chat/srv-1/chan-2?message=msg-3",
        ORIGINS,
      ),
    ).toEqual({
      kind: "conversation",
      conversation: "channel",
      channelId: "chan-2",
      serverId: "srv-1",
      messageId: "msg-3",
    });
  });

  it("reads a DM link (the @me segment, encoded or not)", () => {
    for (const server of ["@me", "%40me"]) {
      expect(
        parseAppLink(`https://web.example/chat/${server}/dm-9`, ORIGINS),
      ).toEqual({
        kind: "conversation",
        conversation: "dm",
        channelId: "dm-9",
        serverId: null,
        messageId: null,
      });
    }
  });

  it("reads the app's own scheme", () => {
    expect(parseAppLink("ralphmeet-dev://invite/xyz", ORIGINS)).toEqual({
      kind: "invite",
      code: "xyz",
    });
    expect(
      parseAppLink("ralphmeet-dev://channel/c1?message=m1", ORIGINS),
    ).toEqual({
      kind: "conversation",
      conversation: "channel",
      channelId: "c1",
      serverId: null,
      messageId: "m1",
    });
  });

  it("ignores other hosts, schemes and pages", () => {
    expect(parseAppLink("https://other.example/invite/x", ORIGINS)).toBeNull();
    expect(parseAppLink("ralphmeet://invite/x", ORIGINS)).toBeNull();
    expect(parseAppLink("https://web.example/chat", ORIGINS)).toBeNull();
    expect(parseAppLink("https://web.example/chat/srv-1", ORIGINS)).toBeNull();
    expect(parseAppLink("https://web.example/share/t", ORIGINS)).toBeNull();
    expect(parseAppLink("not a url", ORIGINS)).toBeNull();
  });
});

describe("appPathOf", () => {
  it("maps links onto the app's routes", () => {
    expect(appPathOf({ kind: "invite", code: "a b" })).toBe("/invite/a%20b");
    expect(
      appPathOf({
        kind: "conversation",
        conversation: "dm",
        channelId: "d1",
        serverId: null,
        messageId: "m1",
      }),
    ).toBe("/dm/d1?message=m1");
    expect(
      appPathOf({
        kind: "conversation",
        conversation: "channel",
        channelId: "c1",
        serverId: "s1",
        messageId: null,
      }),
    ).toBe("/channel/c1");
  });
});

describe("link builders", () => {
  it("builds the web's message and invite links, which parse back", () => {
    const link = messageLink("https://web.example/", null, "d1", "m1");
    expect(link).toBe("https://web.example/chat/%40me/d1?message=m1");
    expect(parseAppLink(link, ORIGINS)).toMatchObject({
      conversation: "dm",
      channelId: "d1",
      messageId: "m1",
    });
    expect(inviteLink("https://web.example", "code")).toBe(
      "https://web.example/invite/code",
    );
  });
});
