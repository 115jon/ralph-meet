import { describe, expect, it } from "vitest";

import { isPublicDemoRoomSlug } from "./realtime-policy";

describe("realtime room policy", () => {
  it("allows generic public room slugs", () => {
    expect(isPublicDemoRoomSlug("weekly-standup")).toBe(true);
    expect(isPublicDemoRoomSlug("demo_room-1")).toBe(true);
  });

  it("reserves application room namespaces for authenticated admission", () => {
    expect(isPublicDemoRoomSlug("global-gateway")).toBe(false);
    expect(isPublicDemoRoomSlug("voice-server-channel")).toBe(false);
    expect(isPublicDemoRoomSlug("dm-call-user-a-user-b")).toBe(false);
    expect(isPublicDemoRoomSlug("bad slug")).toBe(false);
  });
});
