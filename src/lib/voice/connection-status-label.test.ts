import { describe, expect, it } from "vitest";

import { connectionStatus } from "./connection-status-label";

describe("connectionStatus", () => {
  it("labels a connected session as connected", () => {
    expect(connectionStatus("connected", true)).toEqual({
      label: "Connected",
      tone: "good",
    });
  });

  it("labels new and connecting as pending", () => {
    expect(connectionStatus("new", false).tone).toBe("pending");
    expect(connectionStatus("connecting", false)).toEqual({
      label: "Connecting…",
      tone: "pending",
    });
    expect(connectionStatus("", false).tone).toBe("pending");
  });

  it("never reads a joined session as stable once the connection drops", () => {
    // `joined` stays true through a drop; the state must win.
    expect(connectionStatus("reconnecting", true)).toEqual({
      label: "Reconnecting…",
      tone: "warning",
    });
    expect(connectionStatus("disconnected", true)).toEqual({
      label: "Reconnecting…",
      tone: "warning",
    });
    expect(connectionStatus("failed", true)).toEqual({
      label: "Failed",
      tone: "danger",
    });
    expect(connectionStatus("new", true).label).not.toMatch(/stable/i);
  });

  it("treats a deliberate leave as disconnected, not a warning", () => {
    expect(connectionStatus("disconnected", false)).toEqual({
      label: "Disconnected",
      tone: "pending",
    });
  });

  it("maps closed and unknown states to danger instead of raw strings", () => {
    expect(connectionStatus("closed", true).tone).toBe("danger");
    expect(connectionStatus("weird-state", true)).toEqual({
      label: "Connection issue",
      tone: "danger",
    });
  });
});
