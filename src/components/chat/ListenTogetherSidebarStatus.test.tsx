// @vitest-environment jsdom

import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListenTogetherSidebarStatus } from "./ListenTogetherSidebarStatus";

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
    roomSlug: "voice-room-1",
    revision: 1,
    paused: false,
    currentEntryId: currentEntry.entryId,
    anchorPositionMs: 10_000,
    anchorUpdatedAt: 1_000,
    lastUpdatedAt: 1_000,
    queue: [currentEntry],
    currentEntry,
    positionMs: 10_000,
    durationMs: currentEntry.track.durationMs,
  };
}

describe("ListenTogetherSidebarStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useListenTogetherStore.setState({
      rooms: {
        "voice-room-1": {
          snapshot: makeSnapshot(),
          localVolume: 1,
          localPlayback: null,
          error: null,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useListenTogetherStore.setState({ rooms: {} });
  });

  it("keeps playback clock updates isolated from its parent", () => {
    const onParentCommit = vi.fn();

    function Parent() {
      useEffect(() => {
        onParentCommit();
      });
      return <ListenTogetherSidebarStatus roomSlug="voice-room-1" />;
    }

    render(<Parent />);

    expect(screen.getByText("Track One")).toBeInTheDocument();
    expect(screen.getByText("0:10")).toBeInTheDocument();
    expect(onParentCommit).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText("0:11")).toBeInTheDocument();
    expect(onParentCommit).toHaveBeenCalledTimes(1);
  });
});
