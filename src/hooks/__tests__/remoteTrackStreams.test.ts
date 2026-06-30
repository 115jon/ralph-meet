import { describe, expect, it } from "vitest";
import {
  removeRemoteTrackStream,
  type RemoteStreamsByUser,
  upsertRemoteTrackStream,
} from "@/hooks/useVoiceChannel";

describe("remote track stream reducers", () => {
  it("adds a remote track without dropping existing tracks", () => {
    const cam = {} as MediaStream;
    const screen = {} as MediaStream;
    const initial: RemoteStreamsByUser = {
      alice: { "cam-video-alice": cam },
    };

    const next = upsertRemoteTrackStream(initial, "alice", "screen-video-alice", screen);

    expect(next).toEqual({
      alice: {
        "cam-video-alice": cam,
        "screen-video-alice": screen,
      },
    });
    expect(initial.alice).toEqual({ "cam-video-alice": cam });
  });

  it("removes a stopped remote track while preserving other tracks", () => {
    const cam = {} as MediaStream;
    const screen = {} as MediaStream;
    const bob = {} as MediaStream;
    const initial: RemoteStreamsByUser = {
      alice: {
        "cam-video-alice": cam,
        "screen-video-alice": screen,
      },
      bob: {
        "cam-video-bob": bob,
      },
    };

    const next = removeRemoteTrackStream(initial, "alice", "screen-video-alice");

    expect(next).toEqual({
      alice: {
        "cam-video-alice": cam,
      },
      bob: {
        "cam-video-bob": bob,
      },
    });
    expect(initial.alice).toHaveProperty("screen-video-alice", screen);
  });

  it("deletes the user bucket when the last remote track is removed", () => {
    const cam = {} as MediaStream;
    const initial: RemoteStreamsByUser = {
      alice: {
        "cam-video-alice": cam,
      },
    };

    expect(removeRemoteTrackStream(initial, "alice", "cam-video-alice")).toEqual({});
  });

  it("returns the same object when removing an unknown track", () => {
    const cam = {} as MediaStream;
    const initial: RemoteStreamsByUser = {
      alice: {
        "cam-video-alice": cam,
      },
    };

    expect(removeRemoteTrackStream(initial, "alice", "screen-video-alice")).toBe(initial);
  });
});
