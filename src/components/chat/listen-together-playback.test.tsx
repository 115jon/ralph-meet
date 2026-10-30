// @vitest-environment jsdom

import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import {
  getListenTogetherProgressKey,
  useListenTogetherClockNow,
  useListenTogetherPlaybackState,
} from "./listen-together-playback";

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

/** A 1 Hz leaf: what the time labels use instead of the room clock. */
function ClockLeaf({ onRender }: { onRender: () => void }) {
  const playback = useListenTogetherPlaybackState("room-1");
  const ref = useRef<HTMLOutputElement>(null);
  const now = useListenTogetherClockNow(playback, ref);
  onRender();
  return (
    <output ref={ref} aria-label="leaf">
      {now}
    </output>
  );
}

describe("listen together playback", () => {
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

  it("runs no timer and holds a running room still between room updates", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<Consumer label="view" />);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByLabelText("view")).toHaveTextContent("0");
  });

  it("keeps paused progress fixed", () => {
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

    render(<Consumer label="paused" />);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("paused")).toHaveTextContent("5000");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByLabelText("paused")).toHaveTextContent("5000");
  });

  it("ticks a leaf once a second while playing and stops while paused", () => {
    const onRender = vi.fn();
    render(<ClockLeaf onRender={onRender} />);
    const rendersAtMount = onRender.mock.calls.length;

    for (let second = 0; second < 3; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(onRender.mock.calls.length - rendersAtMount).toBe(3);
    expect(screen.getByLabelText("leaf")).toHaveTextContent("4000");

    act(() => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": {
            snapshot: { ...makeSnapshot(), paused: true },
            localVolume: 1,
            error: null,
          },
        },
      });
    });
    const rendersWhenPaused = onRender.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onRender.mock.calls.length).toBe(rendersWhenPaused);
  });

  it("keys the CSS progress on jumps, not on time passing", () => {
    const snapshot = makeSnapshot();
    const running = {
      snapshot,
      localPlayback: null,
      durationMs: 180_000,
    };
    const key = getListenTogetherProgressKey(running);
    expect(getListenTogetherProgressKey({ ...running })).toBe(key);
    expect(
      getListenTogetherProgressKey({
        ...running,
        snapshot: { ...snapshot, paused: true },
      }),
    ).not.toBe(key);
    expect(
      getListenTogetherProgressKey({
        ...running,
        localPlayback: {
          paused: false,
          positionMs: 30_000,
          entryId: "entry-1",
          snapshotRevision: 1,
          source: "seek",
          accepted: false,
        },
      }),
    ).not.toBe(key);
  });
});
