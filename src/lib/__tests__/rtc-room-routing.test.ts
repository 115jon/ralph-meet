import { describe, expect, it } from "vitest";

import {
  normalizeRtcRoomAuthorityMode,
  parseRtcRoomCanaryRooms,
  usesRtcRoomAuthority,
} from "../voice/rtc-room-routing";

describe("rtc-room authority routing", () => {
  it("defaults unknown values to split mode", () => {
    expect(normalizeRtcRoomAuthorityMode(undefined)).toBe("split");
    expect(normalizeRtcRoomAuthorityMode(null)).toBe("split");
    expect(normalizeRtcRoomAuthorityMode("anything-else")).toBe("split");
  });

  it("parses the canary room allowlist", () => {
    expect([...parseRtcRoomCanaryRooms(" room-a,room-b ,, room-c ")]).toEqual([
      "room-a",
      "room-b",
      "room-c",
    ]);
  });

  it("enables unified room authority for all rooms in rtc-room mode", () => {
    expect(usesRtcRoomAuthority("split", "room-a")).toBe(false);
    expect(usesRtcRoomAuthority("rtc-room", "room-a")).toBe(true);
  });

  it("enables unified room authority only for allowlisted rooms in canary mode", () => {
    expect(usesRtcRoomAuthority("canary", "room-a", "room-a,room-b")).toBe(true);
    expect(usesRtcRoomAuthority("canary", "room-c", "room-a,room-b")).toBe(false);
    expect(usesRtcRoomAuthority("canary", undefined, "room-a")).toBe(false);
  });
});
