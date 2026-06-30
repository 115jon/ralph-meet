import { describe, expect, it } from "vitest";

import { getConnectionStatusBadge } from "./connection-status-label";

describe("getConnectionStatusBadge", () => {
  it("labels a joined connected room as connected", () => {
    expect(getConnectionStatusBadge({ joined: true, connectionState: "connected" })).toEqual({
      label: "Connected",
      tone: "good",
    });
  });

  it("labels an unjoined room as connecting", () => {
    expect(getConnectionStatusBadge({ joined: false, connectionState: "new" })).toEqual({
      label: "Connecting",
      tone: "pending",
    });
  });
});
