import { describe, expect, it } from "vitest";
import { getChannelIcon } from "@/lib/channel-icon";
import { PERMISSIONS } from "@/lib/permissions";

const canPost = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES;

describe("getChannelIcon", () => {
  it("uses the voice glyph for voice channels whatever their name", () => {
    expect(getChannelIcon({ name: "rules", channel_type: "voice" })).toBe(
      "voiceChannel",
    );
  });

  it("gives rules and announcement channels their own glyphs", () => {
    expect(getChannelIcon({ name: "rules", channel_type: "text" })).toBe(
      "rules",
    );
    expect(
      getChannelIcon({ name: "Announcements", channel_type: "text" }),
    ).toBe("announcement");
  });

  it("shows a read-only text channel as locked", () => {
    expect(
      getChannelIcon({
        name: "general",
        channel_type: "text",
        permissions: PERMISSIONS.VIEW_CHANNELS,
      }),
    ).toBe("lockedChannel");
  });

  it("keeps the hash for ordinary text channels", () => {
    expect(
      getChannelIcon({
        name: "general",
        channel_type: "text",
        permissions: canPost,
      }),
    ).toBe("textChannel");
    expect(getChannelIcon({ name: "general", channel_type: "text" })).toBe(
      "textChannel",
    );
  });

  it("does not treat administrators as read-only", () => {
    expect(
      getChannelIcon({
        name: "general",
        channel_type: "text",
        permissions: PERMISSIONS.ADMINISTRATOR,
      }),
    ).toBe("textChannel");
  });
});
