import { describe, expect, it } from "vitest";

import type { GridItem } from "@/components/voice/types";
import type { StreamWatchSnapshotPayload } from "@/lib/types";
import {
  applyStreamWatcherSnapshot,
  buildWatchedStreamsForLocalViewer,
  buildStreamWatcherIdentities,
  getStreamWatcherActivitySound,
  isStreamWatcherSnapshotPayload,
  resolveWatchedStreamsWithPendingIntents,
} from "@/lib/stream-watchers";

function makeGridItem(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: "remote-camera-user-1",
    userId: "user-1",
    name: "Alice",
    avatar: null,
    stream: null,
    isLocal: false,
    type: "camera",
    isStreaming: false,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
    ...overrides,
  };
}

describe("stream watcher helpers", () => {
  it("applies a server snapshot and normalizes duplicate viewer ids", () => {
    const snapshot: StreamWatchSnapshotPayload = {
      type: "stream.watch.snapshot",
      watchers_by_streamer: {
        "user-1": ["user-2", "user-3", "user-2"],
        "user-4": [],
      },
    };

    expect(applyStreamWatcherSnapshot({}, snapshot)).toEqual({
      "user-1": ["user-2", "user-3"],
    });
  });

  it("detects when someone starts watching the local user's stream", () => {
    expect(
      getStreamWatcherActivitySound(
        { "user-1": ["user-2"] },
        { "user-1": ["user-2", "user-3"] },
        "user-1",
      ),
    ).toBe("start");
  });

  it("detects when someone stops watching the local user's stream", () => {
    expect(
      getStreamWatcherActivitySound(
        { "user-1": ["user-2", "user-3"] },
        { "user-1": ["user-3"] },
        "user-1",
      ),
    ).toBe("stop");
  });

  it("ignores watcher changes for someone else's stream", () => {
    expect(
      getStreamWatcherActivitySound(
        { "user-9": ["user-2"] },
        { "user-9": ["user-2", "user-3"] },
        "user-1",
      ),
    ).toBeNull();
  });

  it("builds watcher identities from grid items and labels the local viewer as You", () => {
    const identities = buildStreamWatcherIdentities(
      {
        "user-1": ["user-2", "user-3"],
      },
      [
        makeGridItem(),
        makeGridItem({
          id: "remote-camera-user-2",
          userId: "user-2",
          name: "Bob",
          avatar: "/bob.png",
        }),
        makeGridItem({
          id: "local-camera-user-3",
          userId: "user-3",
          name: "Carla",
          isLocal: true,
        }),
      ],
      "user-3",
    );

    expect(identities["user-1"]).toEqual([
      { userId: "user-2", name: "Bob", avatar: "/bob.png", isLocal: false },
      { userId: "user-3", name: "You", avatar: null, isLocal: true },
    ]);
  });

  it("builds watched streams for the local viewer from a watcher snapshot", () => {
    expect(
      buildWatchedStreamsForLocalViewer(
        {
          "user-1": ["user-2"],
          "user-3": ["user-4"],
        },
        "user-2",
      ),
    ).toEqual({
      "user-1": true,
    });
  });

  it("preserves optimistic local watch intents until the snapshot catches up", () => {
    expect(
      resolveWatchedStreamsWithPendingIntents(
        {},
        "user-9",
        { "user-1": true },
      ),
    ).toEqual({
      watchedStreams: { "user-1": true },
      pendingIntents: { "user-1": true },
    });

    expect(
      resolveWatchedStreamsWithPendingIntents(
        { "user-1": ["user-9"] },
        "user-9",
        { "user-1": true },
      ),
    ).toEqual({
      watchedStreams: { "user-1": true },
      pendingIntents: {},
    });
  });

  it("recognizes stream watcher snapshot payloads", () => {
    expect(
      isStreamWatcherSnapshotPayload({
        type: "stream.watch.snapshot",
        watchers_by_streamer: { "user-1": ["user-2"] },
      }),
    ).toBe(true);

    expect(
      isStreamWatcherSnapshotPayload({
        type: "demo.chat.send",
      }),
    ).toBe(false);
  });
});
