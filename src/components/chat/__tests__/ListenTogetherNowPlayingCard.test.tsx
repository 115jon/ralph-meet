// @vitest-environment jsdom

import type { ListenTogetherPlaybackState } from "@/components/chat/listen-together-playback";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListenTogetherNowPlayingCard } from "../ListenTogetherNowPlayingCard";

function makePlaybackState(
  overrides: Partial<ListenTogetherPlaybackState> = {},
): ListenTogetherPlaybackState {
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
      id: "track-1",
      provider: "youtube" as const,
      videoId: "video-1",
      title: "Track One",
      artist: "Artist",
      album: null,
      durationMs: 180_000,
      artworkUrl: "https://img.example/track-1.jpg",
      canonicalUrl: "https://www.youtube.com/watch?v=video-1",
      sourceUrl: null,
      sourceLabel: "YouTube",
    },
    importBatchId: null,
    importBatchLabel: null,
  };

  return {
    currentEntry,
    durationMs: currentEntry.track.durationMs,
    effectiveSeekValue: 5_000,
    error: null,
    localVolume: 1,
    progressMax: currentEntry.track.durationMs,
    setLocalVolume: vi.fn(),
    snapshot: {
      roomSlug: "room-1",
      revision: 1,
      paused: false,
      currentEntryId: currentEntry.entryId,
      anchorPositionMs: 0,
      anchorUpdatedAt: 1_000,
      lastUpdatedAt: 1_000,
      queue: [currentEntry],
      currentEntry,
      positionMs: 5_000,
      durationMs: currentEntry.track.durationMs,
    },
    ...overrides,
  };
}

describe("ListenTogetherNowPlayingCard", () => {
  it("renders a compact mini player and forwards control actions", () => {
    const sendAppEvent = vi.fn();
    const onOpenQueue = vi.fn();

    render(
      <ListenTogetherNowPlayingCard
        playback={makePlaybackState()}
        sfu={{ voiceGW: { sendAppEvent } } as any}
        roomSlug="room-1"
        variant="mini"
        onOpenQueue={onOpenQueue}
      />,
    );

    expect(screen.getByText("Track One")).toBeInTheDocument();
    expect(screen.getByText("Requested by Alice")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open listen together queue" }));
    expect(onOpenQueue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Pause shared playback" }));
    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "listen_together.pause",
      room_slug: "room-1",
      paused: true,
    });
  });

  it("stays hidden in mini mode when nothing is currently playing", () => {
    const playback = makePlaybackState({
      currentEntry: null,
      snapshot: {
        roomSlug: "room-1",
        revision: 1,
        paused: true,
        currentEntryId: null,
        anchorPositionMs: 0,
        anchorUpdatedAt: 1_000,
        lastUpdatedAt: 1_000,
        queue: [],
        currentEntry: null,
        positionMs: 0,
        durationMs: null,
      },
      durationMs: 0,
      effectiveSeekValue: 0,
      progressMax: 1,
    });

    const { container } = render(
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={null}
        roomSlug="room-1"
        variant="mini"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
