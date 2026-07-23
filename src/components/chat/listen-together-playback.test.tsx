// @vitest-environment jsdom

import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListenTogetherPlaybackState } from "./listen-together-playback";

function makeSnapshot(): ListenTogetherStateSnapshot {
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
  };
}

function Consumer({
  label,
  roomSlug = "room-1",
}: {
  label: string;
  roomSlug?: string;
}) {
  const playback = useListenTogetherPlaybackState(roomSlug);
  return <output aria-label={label}>{playback.effectiveSeekValue}</output>;
}

describe("listen together playback clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useListenTogetherStore.setState({
      rooms: {
        "room-1": { snapshot: makeSnapshot(), localVolume: 1, error: null },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    useListenTogetherStore.setState({ rooms: {} });
  });

  it("uses one room-scoped timer for multiple playback consumers", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(
      <>
        <Consumer label="first" />
        <Consumer label="second" />
      </>,
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByLabelText("first")).toHaveTextContent("1000");
    expect(screen.getByLabelText("second")).toHaveTextContent("1000");
  });

  it("does not keep a room clock running while playback is paused", () => {
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: { ...makeSnapshot(), paused: true },
          localVolume: 1,
          error: null,
        },
      },
    });
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(<Consumer label="paused" />);

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("keeps paused progress fixed while active consumers share one room clock", () => {
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: {
            ...makeSnapshot(),
            paused: true,
            anchorPositionMs: 5_000,
            positionMs: 5_000,
          },
          localVolume: 1,
          error: null,
        },
      },
    });
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(
      <>
        <Consumer label="paused-first" />
        <Consumer label="paused-second" />
      </>,
    );

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("paused-first")).toHaveTextContent("5000");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByLabelText("paused-first")).toHaveTextContent("5000");
    expect(screen.getByLabelText("paused-second")).toHaveTextContent("5000");
  });

  it("cleans up room clocks and isolates timers by room", () => {
    useListenTogetherStore.setState({
      rooms: {
        "room-1": { snapshot: makeSnapshot(), localVolume: 1, error: null },
        "room-2": {
          snapshot: { ...makeSnapshot(), roomSlug: "room-2" },
          localVolume: 1,
          error: null,
        },
      },
    });
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = render(
      <>
        <Consumer label="room-one" roomSlug="room-1" />
        <Consumer label="room-two" roomSlug="room-2" />
      </>,
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
  });
});
