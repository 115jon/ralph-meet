import type {
  ListenTogetherQueueEntrySeed,
  ListenTogetherTrack,
  ListenTogetherRadioTrack,
} from "@/lib/listen-together";
import { createListenTogetherState } from "@/lib/listen-together";
import {
  enqueueListenTogetherEntries,
  freezeListenTogetherPlayback,
  skipListenTogether,
} from "@/lib/voice/listen-together-state";
import { describe, expect, it } from "vitest";

function makeTrack(
  id: string,
  title: string,
  durationMs = 180_000,
): ListenTogetherTrack {
  return {
    kind: "music",
    id,
    provider: "youtube",
    videoId: `${id}-video`,
    title,
    artist: "Artist",
    album: null,
    durationMs,
    artworkUrl: null,
    canonicalUrl: `https://www.youtube.com/watch?v=${id}-video`,
    sourceUrl: null,
    sourceLabel: "YouTube",
  };
}

function makeRadioTrack(
  id: string,
  title: string,
  streamUrl: string,
): ListenTogetherRadioTrack {
  return {
    kind: "radio",
    id,
    provider: "radio",
    title,
    artist: null,
    artworkUrl: null,
    canonicalUrl: streamUrl,
    streamUrl,
    sourceLabel: "Live Radio",
  };
}

function makeSeed(
  track: ListenTogetherTrack,
  overrides: Partial<ListenTogetherQueueEntrySeed> = {},
): ListenTogetherQueueEntrySeed {
  return {
    track,
    requester: {
      userId: "user-1",
      displayName: "Alice",
      avatarUrl: null,
      avatarDisplay: null,
    },
    ...overrides,
  };
}

describe("listen together room state helpers", () => {
  it("auto-starts the first queued item when the room is idle", () => {
    const now = 1_000;
    const result = enqueueListenTogetherEntries(
      "room-1",
      [],
      createListenTogetherState("room-1", now),
      [makeSeed(makeTrack("track-1", "First Song"))],
      "append",
      now,
    );

    expect(result.queue).toHaveLength(1);
    expect(result.state.currentEntryId).toBe(result.queue[0].entryId);
    expect(result.state.paused).toBe(false);
    expect(result.playbackChanged).toBe(true);
  });

  it("inserts play-next tracks directly after the current entry", () => {
    const initial = enqueueListenTogetherEntries(
      "room-1",
      [],
      createListenTogetherState("room-1", 1_000),
      [
        makeSeed(makeTrack("track-1", "Current")),
        makeSeed(makeTrack("track-2", "Later")),
      ],
      "append",
      1_000,
    );

    const playNext = enqueueListenTogetherEntries(
      "room-1",
      initial.queue,
      initial.state,
      [makeSeed(makeTrack("track-3", "Next Up"))],
      "play-next",
      2_000,
    );

    expect(playNext.queue.map((entry) => entry.track.title)).toEqual([
      "Current",
      "Next Up",
      "Later",
    ]);
    expect(playNext.state.currentEntryId).toBe(initial.state.currentEntryId);
  });

  it("preserves provider order and batch metadata for collection imports", () => {
    const importBatchId = "batch-1";
    const result = enqueueListenTogetherEntries(
      "room-1",
      [],
      createListenTogetherState("room-1", 10),
      [
        makeSeed(makeTrack("track-1", "First"), {
          importBatchId,
          importBatchLabel: "Playlist A",
        }),
        makeSeed(makeTrack("track-2", "Second"), {
          importBatchId,
          importBatchLabel: "Playlist A",
        }),
        makeSeed(makeTrack("track-3", "Third"), {
          importBatchId,
          importBatchLabel: "Playlist A",
        }),
      ],
      "append",
      10,
    );

    expect(result.queue.map((entry) => entry.track.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(new Set(result.queue.map((entry) => entry.importBatchId))).toEqual(
      new Set([importBatchId]),
    );
    expect(
      new Set(result.queue.map((entry) => entry.importBatchLabel)),
    ).toEqual(new Set(["Playlist A"]));
  });

  it("freezes playback at the current position when the room empties", () => {
    const started = enqueueListenTogetherEntries(
      "room-1",
      [],
      createListenTogetherState("room-1", 1_000),
      [makeSeed(makeTrack("track-1", "Long Song", 10_000))],
      "append",
      1_000,
    );

    const frozen = freezeListenTogetherPlayback(
      "room-1",
      started.queue,
      started.state,
      4_500,
    );

    expect(frozen.state.paused).toBe(true);
    expect(frozen.state.anchorPositionMs).toBe(3_500);
    expect(frozen.playbackChanged).toBe(true);
  });

  it("skips forward by removing the current entry and promoting the next one", () => {
    const started = enqueueListenTogetherEntries(
      "room-1",
      [],
      createListenTogetherState("room-1", 1_000),
      [
        makeSeed(makeTrack("track-1", "Current")),
        makeSeed(makeTrack("track-2", "Next")),
      ],
      "append",
      1_000,
    );

    const skipped = skipListenTogether(
      "room-1",
      started.queue,
      started.state,
      2_000,
    );

    expect(skipped.queue.map((entry) => entry.track.title)).toEqual(["Next"]);
    expect(skipped.state.currentEntryId).toBe(skipped.queue[0].entryId);
  });

  it("enqueues a radio track with infinite duration", () => {
    const now = 1_000;
    const radioTrack = makeRadioTrack(
      "radio-1",
      "Live Station",
      "https://stream.example.com/live",
    );

    const result = enqueueListenTogetherEntries(
      "room-1",
      [],
      createListenTogetherState("room-1", now),
      [makeSeed(radioTrack)],
      "append",
      now,
    );

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].track.kind).toBe("radio");
    expect(result.state.currentEntryId).toBe(result.queue[0].entryId);
  });

  it("allows manual skip from radio to next track", () => {
    const started = enqueueListenTogetherEntries(
      "room-1",
      [],
      createListenTogetherState("room-1", 1_000),
      [
        makeSeed(
          makeRadioTrack(
            "radio-1",
            "Live Radio",
            "https://stream.example.com/live",
          ),
        ),
        makeSeed(makeTrack("track-1", "Next Song")),
      ],
      "append",
      1_000,
    );

    const skipped = skipListenTogether(
      "room-1",
      started.queue,
      started.state,
      2_000,
    );

    expect(skipped.queue).toHaveLength(1);
    expect(skipped.queue[0].track.kind).toBe("music");
    expect(skipped.state.currentEntryId).toBe(skipped.queue[0].entryId);
  });
});
