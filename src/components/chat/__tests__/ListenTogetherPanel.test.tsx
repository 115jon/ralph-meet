// @vitest-environment jsdom

import { apiGet, apiPost } from "@/lib/api-client";
import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
      kind: "music" as const,
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
    expect(
      container.querySelectorAll('img[src="https://img.example/track-1.jpg"]')
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      container.querySelectorAll('img[src="https://img.example/avatar-1.png"]')
        .length,
    ).toBeGreaterThanOrEqual(2);
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

    const input = screen.getByPlaceholderText(
      "Search or paste YouTube / Spotify links",
    );
    fireEvent.change(input, { target: { value: "oui" } });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(apiGet).mock.calls[0]?.[0] ?? "")).toContain(
      "q=oui",
    );
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("automatically resolves supported links into a preview", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      kind: "track",
      tracks: [
        {
          kind: "music",
          id: "spotify:video-1",
          provider: "spotify",
          videoId: "video-1",
          title: "Resolved Track",
          artist: "Resolved Artist",
          album: null,
          durationMs: 180_000,
          artworkUrl: "https://img.example/resolved.jpg",
          canonicalUrl: "https://www.youtube.com/watch?v=video-1",
          sourceUrl: "https://open.spotify.com/track/3rdhviQpre30wOnZuE3oWu",
          sourceLabel: "Spotify",
        },
      ],
      collection: null,
      resolvedCount: 1,
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

    const input = screen.getByPlaceholderText(
      "Search or paste YouTube / Spotify links",
    );
    fireEvent.change(input, {
      target: {
        value:
          "https://open.spotify.com/track/3rdhviQpre30wOnZuE3oWu?si=42dbff3a4b6d420d",
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Resolved Track")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resolve & Queue" }),
    ).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("queues a resolved preview only after its queue action is clicked", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      kind: "track",
      tracks: [
        {
          kind: "music",
          id: "youtube:video-1",
          provider: "youtube",
          videoId: "video-1",
          title: "Resolved Track",
          artist: "Resolved Artist",
          album: null,
          durationMs: 180_000,
          artworkUrl: null,
          canonicalUrl: "https://www.youtube.com/watch?v=video-1",
          sourceUrl: "https://www.youtube.com/watch?v=video-1",
          sourceLabel: "YouTube",
        },
      ],
      collection: null,
      resolvedCount: 1,
      skippedCount: 0,
      skippedItems: [],
    });

    const sendAppEvent = vi.fn();
    render(
      <ListenTogetherPanel
        sfu={
          {
            resumeAudioContext: vi.fn(),
            voiceGW: { sendAppEvent },
          } as never
        }
        roomSlug="room-1"
        voiceSessionId="voice-1"
        localUserId="user-1"
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("Search or paste YouTube / Spotify links"),
      {
        target: { value: "https://www.youtube.com/watch?v=video-1" },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendAppEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "listen_together.enqueue" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "listen_together.enqueue",
        entries: [
          expect.objectContaining({
            track: expect.objectContaining({ title: "Resolved Track" }),
          }),
        ],
      }),
    );
  });

  it("aggregates playlist batches into one preview before queueing", async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({
        kind: "collection",
        tracks: [
          {
            kind: "music",
            id: "youtube:video-1",
            provider: "youtube",
            videoId: "video-1",
            title: "Playlist Track One",
            artist: "Artist One",
            album: null,
            durationMs: 180_000,
            artworkUrl: null,
            canonicalUrl: "https://www.youtube.com/watch?v=video-1",
            sourceUrl: "https://www.youtube.com/playlist?list=playlist-1",
            sourceLabel: "YouTube",
          },
        ],
        collection: {
          id: "youtube_playlist:playlist-1",
          provider: "youtube",
          title: "Playlist Preview",
          subtitle: "Artist One",
          itemCount: 2,
          artworkUrl: null,
          sourceUrl: "https://www.youtube.com/playlist?list=playlist-1",
        },
        resolvedCount: 1,
        skippedCount: 0,
        skippedItems: [],
        nextOffset: 1,
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        kind: "collection",
        tracks: [
          {
            kind: "music",
            id: "youtube:video-2",
            provider: "youtube",
            videoId: "video-2",
            title: "Playlist Track Two",
            artist: "Artist Two",
            album: null,
            durationMs: 200_000,
            artworkUrl: null,
            canonicalUrl: "https://www.youtube.com/watch?v=video-2",
            sourceUrl: "https://www.youtube.com/playlist?list=playlist-1",
            sourceLabel: "YouTube",
          },
        ],
        collection: {
          id: "youtube_playlist:playlist-1",
          provider: "youtube",
          title: "Playlist Preview",
          subtitle: "Artist One",
          itemCount: 2,
          artworkUrl: null,
          sourceUrl: "https://www.youtube.com/playlist?list=playlist-1",
        },
        resolvedCount: 1,
        skippedCount: 0,
        skippedItems: [],
        nextOffset: null,
        totalCount: 2,
      });

    render(
      <ListenTogetherPanel
        sfu={null}
        roomSlug="room-1"
        voiceSessionId="voice-1"
        localUserId="user-1"
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("Search or paste YouTube / Spotify links"),
      {
        target: {
          value: "https://www.youtube.com/playlist?list=playlist-1",
        },
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Playlist Preview")).toBeInTheDocument();
    expect(screen.getByText("Playlist Track One")).toBeInTheDocument();
    expect(screen.getByText("Playlist Track Two")).toBeInTheDocument();
  });

  it("keeps collection search results as an immediate queue action", async () => {
    vi.useFakeTimers();
    vi.mocked(apiGet).mockResolvedValue({
      filter: "track",
      results: [
        {
          kind: "collection",
          id: "youtube_playlist:playlist-1",
          provider: "youtube",
          title: "Search Playlist",
          subtitle: "Artist",
          itemCount: 2,
          artworkUrl: null,
          sourceUrl: "https://www.youtube.com/playlist?list=playlist-1",
        },
      ],
      cursor: null,
    });
    vi.mocked(apiPost).mockResolvedValue({
      kind: "collection",
      tracks: [
        {
          kind: "music",
          id: "youtube:video-1",
          provider: "youtube",
          videoId: "video-1",
          title: "Queued Search Track",
          artist: "Artist",
          album: null,
          durationMs: 180_000,
          artworkUrl: null,
          canonicalUrl: "https://www.youtube.com/watch?v=video-1",
          sourceUrl: "https://www.youtube.com/playlist?list=playlist-1",
          sourceLabel: "YouTube",
        },
      ],
      collection: {
        id: "youtube_playlist:playlist-1",
        provider: "youtube",
        title: "Search Playlist",
        subtitle: "Artist",
        itemCount: 1,
        artworkUrl: null,
        sourceUrl: "https://www.youtube.com/playlist?list=playlist-1",
      },
      resolvedCount: 1,
      skippedCount: 0,
      skippedItems: [],
      nextOffset: null,
      totalCount: 1,
    });

    const sendAppEvent = vi.fn();
    render(
      <ListenTogetherPanel
        sfu={
          {
            resumeAudioContext: vi.fn(),
            voiceGW: { sendAppEvent },
          } as never
        }
        roomSlug="room-1"
        voiceSessionId="voice-1"
        localUserId="user-1"
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("Search or paste YouTube / Spotify links"),
      { target: { value: "playlist" } },
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "Queue Collection" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "listen_together.enqueue" }),
    );
  });
});
