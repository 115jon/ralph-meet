// @vitest-environment jsdom

import { apiGet, apiPost } from "@/lib/api-client";
import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListenTogetherPanel } from "../ListenTogetherPanel";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

function makeSnapshot(): ListenTogetherStateSnapshot {
  const currentEntry = {
    entryId: "entry-1",
    requestedAt: 1_000,
    requester: {
      userId: "user-1",
      displayName: "Alice",
      avatarUrl: "https://img.example/avatar-1.png",
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
    importBatchId: "batch-1",
    importBatchLabel: "Playlist A",
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
    positionMs: 5_000,
    durationMs: currentEntry.track.durationMs,
  };
}

describe("ListenTogetherPanel", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: makeSnapshot(),
          localVolume: 1,
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

  it("renders requester and batch metadata from the room snapshot", () => {
    const { container } = render(
      <ListenTogetherPanel
        sfu={null}
        roomSlug="room-1"
        voiceSessionId="voice-1"
        localUserId="user-1"
      />,
    );

    expect(screen.getAllByText("Track One").length).toBeGreaterThan(0);
    expect(screen.getByText("Requested by Alice")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getAllByText("Playlist A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("YouTube").length).toBeGreaterThan(0);
    expect(container.querySelectorAll('img[src="https://img.example/track-1.jpg"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('img[src="https://img.example/avatar-1.png"]').length).toBeGreaterThanOrEqual(2);
  });

  it("advances the displayed progress locally while playback is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(6_000);

    render(
      <ListenTogetherPanel
        sfu={null}
        roomSlug="room-1"
        voiceSessionId="voice-1"
        localUserId="user-1"
      />,
    );

    expect(screen.getByText("0:05")).toBeInTheDocument();
    const progressSlider = screen.getAllByRole("slider")[0] as HTMLInputElement;
    const startingValue = Number(progressSlider.value);

    vi.setSystemTime(8_000);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(Number(progressSlider.value)).toBeGreaterThan(startingValue);
  });

  it("uses the shared input to search when the value is plain text", async () => {
    vi.useFakeTimers();
    vi.mocked(apiGet).mockResolvedValue({
      filter: "track",
      results: [],
      cursor: null,
    });

    render(
      <ListenTogetherPanel
        sfu={null}
        roomSlug="room-1"
        voiceSessionId="voice-1"
        localUserId="user-1"
      />,
    );

    const input = screen.getByPlaceholderText("Search or paste YouTube / Spotify links");
    fireEvent.change(input, { target: { value: "oui" } });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(apiGet).mock.calls[0]?.[0] ?? "")).toContain("q=oui");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("uses the shared input to resolve supported links", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      kind: "track",
      tracks: [],
      collection: null,
      resolvedCount: 0,
      skippedCount: 0,
      skippedItems: [],
    });

    render(
      <ListenTogetherPanel
        sfu={null}
        roomSlug="room-1"
        voiceSessionId="voice-1"
        localUserId="user-1"
      />,
    );

    const input = screen.getByPlaceholderText("Search or paste YouTube / Spotify links");
    fireEvent.change(input, {
      target: { value: "https://open.spotify.com/track/3rdhviQpre30wOnZuE3oWu?si=42dbff3a4b6d420d" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Resolve & Queue" }));

    await act(async () => {
      await Promise.resolve();
      expect(apiPost).toHaveBeenCalledTimes(1);
    });

    expect(apiGet).not.toHaveBeenCalled();
  });
});
