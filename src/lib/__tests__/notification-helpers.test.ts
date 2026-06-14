import { describe, expect, it } from "vitest";
import { getUnreadNotificationIdsForMessage } from "@/lib/notification-helpers";

describe("getUnreadNotificationIdsForMessage", () => {
  it("returns only unread notifications for the target message", () => {
    expect(
      getUnreadNotificationIdsForMessage(
        [
          { id: "n1", message_id: "m1", channel_id: "c1", is_read: false } as any,
          { id: "n2", message_id: "m1", channel_id: "c1", is_read: true } as any,
          { id: "n3", message_id: "m2", channel_id: "c1", is_read: false } as any,
        ],
        "m1",
        "c1"
      )
    ).toEqual(["n1"]);
  });
});
