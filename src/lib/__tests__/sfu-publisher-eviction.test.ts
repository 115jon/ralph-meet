import { describe, expect, it } from "vitest";

import { decideFailedPublisherSessionEviction } from "../voice/sfu-publisher-eviction";

describe("decideFailedPublisherSessionEviction", () => {
  it("keeps tracks for connected publishers even on permanent viewer pull failures", () => {
    expect(
      decideFailedPublisherSessionEviction({
        ownerConnected: true,
        hasOnlyTransientErrors: false,
      }),
    ).toEqual({
      evict: false,
      reason: "connected-publisher",
    });
  });

  it("evicts disconnected publishers so dead tracks do not linger forever", () => {
    expect(
      decideFailedPublisherSessionEviction({
        ownerConnected: false,
        hasOnlyTransientErrors: false,
      }),
    ).toEqual({
      evict: true,
      reason: "disconnected-publisher",
    });
  });

  it("still protects connected publishers when the failure looks transient", () => {
    expect(
      decideFailedPublisherSessionEviction({
        ownerConnected: true,
        hasOnlyTransientErrors: true,
      }),
    ).toEqual({
      evict: false,
      reason: "connected-publisher",
    });
  });
});
