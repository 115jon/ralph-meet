import { describe, expect, it } from "vitest";
import { getAppTitleBarModel } from "../AppTitleBarModel";

describe("getAppTitleBarModel", () => {
  it("uses the Friends icon and label for the friends home view", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "@me",
        activeChannelId: null,
        activeServer: null,
        dmHomeView: "friends",
      }),
    ).toEqual({ kind: "friends", label: "Friends", iconUrl: null });
  });

  it("uses the Shop icon and label for the shop home view", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "@me",
        activeChannelId: null,
        activeServer: null,
        dmHomeView: "shop",
      }),
    ).toEqual({ kind: "shop", label: "Shop", iconUrl: null });
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
    ).toEqual({ kind: "server", label: "The Lounge", iconUrl: null });
  });

  it("uses the app logo and Direct Messages for a DM", () => {
    expect(
      getAppTitleBarModel({
        activeServerId: "@me",
        activeChannelId: "dm-1",
        activeServer: null,
        dmHomeView: "friends",
      }),
    ).toEqual({ kind: "dm", label: "Direct Messages", iconUrl: null });
  });
});
