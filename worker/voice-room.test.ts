import { describe, expect, it } from "vitest";

import {
  isSupersededVoiceConnection,
  isVoiceReconnectWithinGrace,
} from "../src/lib/voice/connection-generation";

describe("isSupersededVoiceConnection", () => {
  it("treats a socket as stale when the participant row has a newer connection", () => {
    expect(isSupersededVoiceConnection("new-connection", "old-connection")).toBe(true);
  });

  it("allows the current socket to disconnect the participant", () => {
    expect(isSupersededVoiceConnection("current-connection", "current-connection")).toBe(false);
  });

  it("allows legacy sockets without connection metadata", () => {
    expect(isSupersededVoiceConnection("current-connection", undefined)).toBe(false);
    expect(isSupersededVoiceConnection(null, "socket-connection")).toBe(false);
  });
});

describe("isVoiceReconnectWithinGrace", () => {
  it("keeps reconnect transfer enabled only inside the grace window", () => {
    expect(isVoiceReconnectWithinGrace(1_000, 30_999, 30_000)).toBe(true);
    expect(isVoiceReconnectWithinGrace(1_000, 31_000, 30_000)).toBe(false);
  });
});
