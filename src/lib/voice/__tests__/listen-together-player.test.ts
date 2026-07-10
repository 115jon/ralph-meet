// @vitest-environment jsdom

import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import {
  buildListenTogetherStreamUrl,
  getListenTogetherPlaybackPlan,
} from "@/lib/voice/listen-together-player";
import { afterEach, describe, expect, it } from "vitest";

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
    positionMs: 10_000,
    durationMs: currentEntry.track.durationMs,
    ...overrides,
  };
}

describe("listen together playback plan", () => {
  it("requests a seek when drift exceeds the tolerance", () => {
    const plan = getListenTogetherPlaybackPlan({
      snapshot: makeSnapshot({ positionMs: 12_500 }),
      playback: {
        src: "/api/listen-together/stream?videoId=video-1",
        currentTimeMs: 10_000,
        paused: false,
      },
      streamUrl: "/api/listen-together/stream?videoId=video-1",
    });

    expect(plan.seekToMs).toBe(12_500);
    expect(plan.shouldPlay).toBe(true);
  });

  it("keeps the current position when drift is within tolerance", () => {
    const plan = getListenTogetherPlaybackPlan({
      snapshot: makeSnapshot({ positionMs: 10_400 }),
      playback: {
        src: "/api/listen-together/stream?videoId=video-1",
        currentTimeMs: 10_000,
        paused: false,
      },
      streamUrl: "/api/listen-together/stream?videoId=video-1",
    });

    expect(plan.seekToMs).toBeNull();
    expect(plan.shouldLoad).toBe(false);
  });

  it("loads and pauses when the authoritative snapshot is paused on a new source", () => {
    const plan = getListenTogetherPlaybackPlan({
      snapshot: makeSnapshot({ paused: true, positionMs: 3_000 }),
      playback: {
        src: null,
        currentTimeMs: 0,
        paused: true,
      },
      streamUrl: "/api/listen-together/stream?videoId=video-1",
    });

    expect(plan.shouldLoad).toBe(true);
    expect(plan.shouldPause).toBe(true);
    expect(plan.shouldPlay).toBe(false);
    expect(plan.seekToMs).toBe(3_000);
  });

  it("stops local playback when there is no active room entry", () => {
    const plan = getListenTogetherPlaybackPlan({
      snapshot: null,
      playback: {
        src: "/api/listen-together/stream?videoId=video-1",
        currentTimeMs: 5_000,
        paused: false,
      },
      streamUrl: null,
    });

    expect(plan.nextSrc).toBeNull();
    expect(plan.shouldPause).toBe(true);
    expect(plan.shouldPlay).toBe(false);
  });
});

afterEach(() => {
  localStorage.clear();
  delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
});

describe("listen together stream url", () => {
  it("uses the tokenized media URL path for tauri audio playback", () => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    localStorage.setItem("desktop_auth_token", "desktop-token");

    const parsed = new URL(
      buildListenTogetherStreamUrl({
        videoId: "abc123def45",
        roomSlug: "room-1",
        voiceSessionId: "session-1",
        preferredFormat: "mp4",
      }),
      window.location.origin,
    );

    expect(parsed.pathname).toBe("/api/listen-together/stream");
    expect(parsed.searchParams.get("videoId")).toBe("abc123def45");
    expect(parsed.searchParams.get("roomSlug")).toBe("room-1");
    expect(parsed.searchParams.get("sessionId")).toBe("session-1");
    expect(parsed.searchParams.get("format")).toBe("mp4");
    expect(parsed.searchParams.get("token")).toBe("desktop-token");
  });
});
