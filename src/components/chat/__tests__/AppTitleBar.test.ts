import { describe, expect, it } from "vitest";
import { formatAppTitle, getAppTitleBarModel } from "../AppTitleBarModel";

describe("getAppTitleBarModel", () => {
  it("uses the Friends icon and label for the friends home view", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "@me",
        activeChannelId: null,
        activeServer: null,
        dmHomeView: "friends",
      }),
    ).toEqual({ kind: "friends", label: "Friends", detail: "", iconUrl: null });
  });

  it("uses the Shop icon and label for the shop home view", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "@me",
        activeChannelId: null,
        activeServer: null,
        dmHomeView: "shop",
      }),
    ).toEqual({ kind: "shop", label: "Shop", detail: "", iconUrl: null });
  });

  it("uses the server icon and name for a server view", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "server-1",
        activeChannelId: "channel-1",
        activeServer: { name: "The Lounge", icon_url: "/server.png" },
        dmHomeView: "friends",
      }),
    ).toEqual({
      kind: "server",
      label: "The Lounge",
      detail: "",
      iconUrl: "/server.png",
    });
  });

  it("keeps the server identity while falling back to the app logo", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "server-1",
        activeChannelId: "channel-1",
        activeServer: { name: "The Lounge", icon_url: null },
        dmHomeView: "friends",
      }),
    ).toEqual({
      kind: "server",
      label: "The Lounge",
      detail: "",
      iconUrl: null,
    });
  });

  it("uses the app logo and Direct messages for a DM", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "@me",
        activeChannelId: "dm-1",
        activeServer: null,
        dmHomeView: "friends",
      }),
    ).toEqual({
      kind: "dm",
      label: "Direct messages",
      detail: "",
      iconUrl: null,
    });
  });

  it("names the open channel before the server, and the DM handle", () => {
    const server = getAppTitleBarModel({
      activeServerId: "server-1",
      activeChannelId: "channel-1",
      activeServer: { name: "The Lounge", icon_url: null },
      dmHomeView: "friends",
      activeChannel: { name: "general", channel_type: "text" },
    });
    expect(formatAppTitle(server)).toBe("#general · The Lounge");

    const voice = getAppTitleBarModel({
      activeServerId: "server-1",
      activeChannelId: "channel-2",
      activeServer: { name: "The Lounge", icon_url: null },
      dmHomeView: "friends",
      activeChannel: { name: "Lounge", channel_type: "voice" },
    });
    expect(formatAppTitle(voice)).toBe("Lounge · The Lounge");

    const dm = getAppTitleBarModel({
      activeServerId: "@me",
      activeChannelId: "dm-1",
      activeServer: null,
      dmHomeView: "friends",
      dmUsername: "ada",
    });
    expect(formatAppTitle(dm)).toBe("@ada · Direct messages");
  });
});
