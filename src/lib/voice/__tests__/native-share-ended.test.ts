import { describe, expect, it } from "vitest";

import {
  parseNativeShareEndedPayload,
  resolveNativeShareEndedAction,
} from "@/lib/voice/native-share-ended";

describe("parseNativeShareEndedPayload", () => {
  it("reads the object payload", () => {
    expect(
      parseNativeShareEndedPayload({
        reason: "connection-failed",
        detail: "disconnected",
      }),
    ).toEqual({ reason: "connection-failed", detail: "disconnected" });
  });

  it("reads the legacy string payload", () => {
    expect(
      parseNativeShareEndedPayload("source-closed: target_exited"),
    ).toEqual({ reason: "source-closed", detail: "target_exited" });
  });

  it("treats anything else as unknown", () => {
    expect(parseNativeShareEndedPayload(null).reason).toBe("unknown");
    expect(parseNativeShareEndedPayload({ reason: 7 }).reason).toBe("unknown");
    expect(parseNativeShareEndedPayload("weird").reason).toBe("unknown");
  });
});

describe("resolveNativeShareEndedAction", () => {
  const failed = parseNativeShareEndedPayload({
    reason: "connection-failed",
    detail: "failed",
  });
  const closed = parseNativeShareEndedPayload({
    reason: "source-closed",
    detail: "target_exited",
  });

  it("falls back to CEF when the connection fails and WGC capture is allowed", () => {
    expect(
      resolveNativeShareEndedAction(failed, {
        isSharing: true,
        wgcCaptureAllowed: true,
      }),
    ).toBe("fallback-cef");
  });

  it("stops on connection failure under the hook-exclusive policy", () => {
    expect(
      resolveNativeShareEndedAction(failed, {
        isSharing: true,
        wgcCaptureAllowed: false,
      }),
    ).toBe("stop");
  });

  it("stops when the source closed, whatever the policy", () => {
    for (const wgcCaptureAllowed of [true, false]) {
      expect(
        resolveNativeShareEndedAction(closed, {
          isSharing: true,
          wgcCaptureAllowed,
        }),
      ).toBe("stop");
    }
  });

  it("ignores events once the share is already stopped", () => {
    expect(
      resolveNativeShareEndedAction(failed, {
        isSharing: false,
        wgcCaptureAllowed: true,
      }),
    ).toBe("ignore");
  });

  it("stops on unrecognized reasons", () => {
    expect(
      resolveNativeShareEndedAction(parseNativeShareEndedPayload("x"), {
        isSharing: true,
        wgcCaptureAllowed: true,
      }),
    ).toBe("stop");
  });
});
