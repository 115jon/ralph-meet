import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { afterEach, describe, expect, it } from "vitest";
import { useListenTogetherStore } from "./useListenTogetherStore";

function makeSnapshot(
  overrides: Partial<ListenTogetherStateSnapshot> = {},
): ListenTogetherStateSnapshot {
  const currentEntry = {
    entryId: "entry-1",
    requestedAt: 1_000,
    requester: {
      userId: "user-1",
      displayName: "Alice",
      avatarUrl: null,
      avatarDisplay: null,
    },
    track: {
      kind: "music" as const,
      id: "track-1",
      provider: "youtube" as const,
      videoId: "video-1",
      title: "Track One",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      artworkUrl: null,
      canonicalUrl: "https://www.youtube.com/watch?v=video-1",
      sourceUrl: null,
      sourceLabel: "YouTube",
    },
  };

  return {
    roomSlug: "room-1",
    revision: 1,
    paused: false,
    currentEntryId: currentEntry.entryId,
    anchorPositionMs: 0,
    anchorUpdatedAt: 1_000,
    lastUpdatedAt: 1_000,
    queue: [currentEntry],
    currentEntry,
    positionMs: 0,
    durationMs: currentEntry.track.durationMs,
    ...overrides,
  };
}

function resetStore() {
  useListenTogetherStore.setState({ rooms: {} });
}

describe("useListenTogetherStore authoritative snapshots", () => {
  afterEach(resetStore);

  it("ignores an older authoritative revision", () => {
    const newer = makeSnapshot({ revision: 3, paused: true });
    useListenTogetherStore.setState({
      rooms: {
        "room-1": { snapshot: newer, localVolume: 1, error: null },
      },
    });

    useListenTogetherStore
      .getState()
      .setSnapshot("room-1", makeSnapshot({ revision: 2, paused: false }));

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      newer,
    );
  });

  it("does not update the room for a duplicate revision and material timestamp", () => {
    const snapshot = makeSnapshot({ revision: 3, lastUpdatedAt: 3_000 });
    useListenTogetherStore.setState({
      rooms: {
        "room-1": { snapshot, localVolume: 1, error: null },
      },
    });
    const roomsBefore = useListenTogetherStore.getState().rooms;

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      queue: [...snapshot.queue],
    });

    expect(useListenTogetherStore.getState().rooms).toBe(roomsBefore);
  });

  it("clears a stale room error while preserving the duplicate snapshot identity", () => {
    const snapshot = makeSnapshot({ revision: 3, lastUpdatedAt: 3_000 });
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          error: { code: "STALE", message: "stale error" },
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      queue: [...snapshot.queue],
    });

    const room = useListenTogetherStore.getState().rooms["room-1"];
    expect(room?.snapshot).toBe(snapshot);
    expect(room?.error).toBeNull();
  });

  it("preserves local playback failures on duplicate authoritative snapshots", () => {
    const snapshot = makeSnapshot({ revision: 3, lastUpdatedAt: 3_000 });
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          error: { code: "PLAYBACK_BLOCKED", message: "Playback blocked" },
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      queue: [...snapshot.queue],
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
      code: "PLAYBACK_BLOCKED",
      message: "Playback blocked",
    });
  });

  it("accepts a newer revision", () => {
    const nextSnapshot = makeSnapshot({ revision: 2, paused: true });
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: makeSnapshot(),
          localVolume: 1,
          error: { code: "OLD", message: "old error" },
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", nextSnapshot);

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      nextSnapshot,
    );
    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toBeNull();
  });

  it("clears accepted optimistic playback when newer authority confirms it", () => {
    const setSnapshot = useListenTogetherStore.getState().setSnapshot;
    const snapshot = makeSnapshot();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: {
            paused: true,
            positionMs: 1_000,
            entryId: "entry-1",
            snapshotRevision: 1,
            source: "command",
            accepted: true,
          },
          error: null,
        },
      },
    });

    setSnapshot("room-1", makeSnapshot({ revision: 2, paused: true }));
    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("consumes optimistic commands through an out-of-order confirmation", () => {
    const snapshot = makeSnapshot();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: {
            paused: false,
            positionMs: 0,
            entryId: "entry-1",
            snapshotRevision: 1,
            source: "command",
            accepted: true,
            pendingStates: [
              { paused: true, positionMs: 0, snapshotRevision: 1, sequence: 1 },
              {
                paused: false,
                positionMs: 0,
                snapshotRevision: 2,
                sequence: 2,
              },
            ],
          },
          error: null,
        },
      },
    });

    useListenTogetherStore
      .getState()
      .setSnapshot("room-1", makeSnapshot({ revision: 3, paused: false }));

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("preserves playback errors across position updates for the same entry", () => {
    const snapshot = makeSnapshot();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          error: { code: "PLAYBACK_FAILED", message: "Playback failed" },
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      positionMs: 2_000,
      lastUpdatedAt: 2_000,
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
      code: "PLAYBACK_FAILED",
      message: "Playback failed",
    });
  });

  it("does not let local playback from one entry affect its successor", () => {
    const successor = makeSnapshot({
      revision: 2,
      currentEntryId: "entry-2",
      currentEntry: {
        ...makeSnapshot().currentEntry!,
        entryId: "entry-2",
      },
    });
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: makeSnapshot(),
          localVolume: 1,
          localPlayback: {
            paused: true,
            positionMs: 1_000,
            entryId: "entry-1",
            snapshotRevision: 1,
            source: "command",
            accepted: true,
          },
          error: null,
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", successor);

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("clears pending native playback when newer authority confirms or rejects it", () => {
    const snapshot = makeSnapshot();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: {
            paused: true,
            positionMs: 1_000,
            entryId: "entry-1",
            snapshotRevision: 1,
            source: "native",
            accepted: false,
          },
          error: null,
        },
      },
    });

    useListenTogetherStore
      .getState()
      .setSnapshot("room-1", makeSnapshot({ revision: 2, paused: true }));

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("keeps the latest rapid command override across an unrelated opposite revision", () => {
    const snapshot = makeSnapshot();
    const optimisticResume = {
      paused: false,
      positionMs: 2_000,
      entryId: "entry-1",
      snapshotRevision: snapshot.revision,
      source: "command" as const,
      accepted: true,
    };
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: {
            ...optimisticResume,
            paused: true,
            source: "command",
          },
          error: null,
        },
      },
    });
    useListenTogetherStore
      .getState()
      .setLocalPlayback("room-1", optimisticResume);

    useListenTogetherStore
      .getState()
      .setSnapshot("room-1", makeSnapshot({ revision: 2, paused: true }));

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBe(optimisticResume);
  });

  it("preserves a native pause across an unpaused refresh until explicit failure", () => {
    const snapshot = makeSnapshot();
    const nativePause = {
      paused: true,
      positionMs: 2_000,
      entryId: "entry-1",
      snapshotRevision: snapshot.revision,
      source: "native" as const,
      accepted: true,
    };
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: nativePause,
          error: null,
        },
      },
    });

    useListenTogetherStore
      .getState()
      .setSnapshot("room-1", makeSnapshot({ revision: 2, paused: false }));
    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBe(nativePause);

    useListenTogetherStore
      .getState()
      .setError("room-1", { code: "COMMAND_REJECTED", message: "Rejected" });
    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBe(nativePause);
  });

  it("accepts a same-revision snapshot when its computed position changes", () => {
    const initial = makeSnapshot({ revision: 3, lastUpdatedAt: 3_000 });
    const refreshed = makeSnapshot({
      revision: 3,
      lastUpdatedAt: 3_000,
      positionMs: 250,
    });
    useListenTogetherStore.setState({
      rooms: { "room-1": { snapshot: initial, localVolume: 1, error: null } },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", refreshed);

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      refreshed,
    );
  });

  it("clears an optimistic override when same-revision authority confirms it", () => {
    const snapshot = makeSnapshot();
    const localPlayback = {
      paused: true,
      positionMs: 1_000,
      entryId: "entry-1",
      snapshotRevision: snapshot.revision,
      source: "command" as const,
      accepted: true,
    };
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback,
          error: null,
        },
      },
    });

    useListenTogetherStore
      .getState()
      .setSnapshot("room-1", { ...snapshot, paused: true, positionMs: 1_000 });

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("confirms a single pending command at the same revision", () => {
    const snapshot = makeSnapshot();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: {
            paused: true,
            positionMs: 1_000,
            entryId: "entry-1",
            snapshotRevision: snapshot.revision,
            source: "command",
            accepted: true,
            pendingStates: [
              {
                paused: true,
                positionMs: 1_000,
                snapshotRevision: snapshot.revision,
                sequence: 1,
              },
            ],
          },
          error: null,
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      paused: true,
      positionMs: 1_000,
    });

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("keeps playback failure state while showing a newer room error", () => {
    useListenTogetherStore.getState().setError("room-1", {
      code: "PLAYBACK_FAILED",
      message: "Playback failed",
    });
    useListenTogetherStore.getState().setError("room-1", {
      code: "EMPTY_QUEUE",
      message: "The queue is empty",
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
      code: "EMPTY_QUEUE",
      message: "The queue is empty",
    });
    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.playbackError,
    ).toEqual({ code: "PLAYBACK_FAILED", message: "Playback failed" });

    useListenTogetherStore.getState().clearRoomError("room-1");
    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
      code: "PLAYBACK_FAILED",
      message: "Playback failed",
    });
  });

  it("ignores local playback metadata written for a non-current entry", () => {
    const snapshot = makeSnapshot();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: null,
          error: null,
        },
      },
    });

    useListenTogetherStore.getState().setLocalPlayback("room-1", {
      paused: true,
      positionMs: 1_000,
      entryId: "entry-2",
      snapshotRevision: snapshot.revision,
      source: "seek",
      accepted: true,
    });

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("keeps a seek override across an unrelated revision for the same entry", () => {
    const snapshot = makeSnapshot();
    const seek = {
      paused: false,
      positionMs: 8_000,
      entryId: "entry-1",
      snapshotRevision: snapshot.revision,
      source: "seek" as const,
      accepted: true,
    };
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: seek,
          error: null,
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      revision: 2,
      paused: false,
      anchorPositionMs: 1_000,
      positionMs: 1_500,
      lastUpdatedAt: 2_000,
    });

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBe(seek);
  });

  it("clears a seek override when authoritative anchor position confirms it", () => {
    const snapshot = makeSnapshot();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: {
            paused: false,
            positionMs: 8_000,
            entryId: "entry-1",
            snapshotRevision: snapshot.revision,
            source: "seek",
            accepted: true,
          },
          error: null,
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      revision: 2,
      anchorPositionMs: 8_400,
      positionMs: 8_500,
      lastUpdatedAt: 2_000,
    });

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("ignores a regressing same-revision position with the same anchor", () => {
    const current = makeSnapshot({
      revision: 4,
      anchorPositionMs: 8_000,
      anchorUpdatedAt: 4_000,
      lastUpdatedAt: 4_000,
      positionMs: 8_500,
    });
    const regressed = {
      ...current,
      positionMs: 7_900,
    };
    useListenTogetherStore.setState({
      rooms: { "room-1": { snapshot: current, localVolume: 1, error: null } },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", regressed);

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      current,
    );
  });

  it("ignores local playback metadata from an older snapshot revision", () => {
    const snapshot = makeSnapshot({ revision: 2 });
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: null,
          error: null,
        },
      },
    });

    useListenTogetherStore.getState().setLocalPlayback("room-1", {
      paused: true,
      positionMs: 1_000,
      entryId: "entry-1",
      snapshotRevision: 1,
      source: "command",
      accepted: true,
    });

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });

  it("consumes rapid command states in order instead of confirming the latest toggle early", () => {
    const snapshot = makeSnapshot();
    const pendingStates = [
      {
        paused: true,
        positionMs: 1_000,
        snapshotRevision: 1,
        sequence: 1,
      },
      {
        paused: false,
        positionMs: 0,
        snapshotRevision: 1,
        sequence: 2,
      },
    ];
    const orderedPlayback = {
      paused: false,
      positionMs: 0,
      entryId: "entry-1",
      snapshotRevision: 1,
      source: "command" as const,
      accepted: true,
      pendingStates,
    } as never;
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot,
          localVolume: 1,
          localPlayback: orderedPlayback,
          error: null,
        },
      },
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      revision: 2,
      paused: false,
      lastUpdatedAt: 2_000,
    });
    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toMatchObject({ pendingStates });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      revision: 3,
      paused: true,
      lastUpdatedAt: 3_000,
    });
    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toMatchObject({
      paused: false,
      pendingStates: [pendingStates[1]],
    });

    useListenTogetherStore.getState().setSnapshot("room-1", {
      ...snapshot,
      revision: 4,
      paused: false,
      lastUpdatedAt: 4_000,
    });
    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
  });
});
