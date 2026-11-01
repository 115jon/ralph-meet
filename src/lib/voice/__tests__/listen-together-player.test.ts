// @vitest-environment jsdom

import type {
  ListenTogetherStateSnapshot,
  ListenTogetherRadioTrack,
} from "@/lib/listen-together";
import {
  buildListenTogetherStreamUrl,
  getListenTogetherPlaybackPlan,
  isExpectedListenTogetherPlayCancellation,
  LISTEN_TOGETHER_MAX_TRANSIENT_RETRIES,
  planListenTogetherPlaybackRecovery,
  probeListenTogetherStream,
  shouldTryAlternateListenTogetherFormat,
} from "@/lib/voice/listen-together-player";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    positionMs: 10_000,
    durationMs: currentEntry.track.durationMs,
    ...overrides,
  };
}

function makeRadioSnapshot(
  overrides: Partial<ListenTogetherStateSnapshot> = {},
): ListenTogetherStateSnapshot {
  const radioTrack: ListenTogetherRadioTrack = {
    kind: "radio",
    id: "radio-1",
    provider: "radio",
    title: "Live Radio Station",
    artist: null,
    artworkUrl: null,
    canonicalUrl: "https://stream.example.com/live",
    streamUrl: "https://stream.example.com/live",
    sourceLabel: "Live Radio",
  };

  const currentEntry = {
    entryId: "radio-entry-1",
    requestedAt: 1_000,
    requester: {
      userId: "user-1",
      displayName: "Alice",
      avatarUrl: null,
      avatarDisplay: null,
    },
    track: radioTrack,
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
    durationMs: null,
    ...overrides,
  };
}

describe("listen together playback plan", () => {
  it("only treats an AbortError as expected when authoritative playback is paused", () => {
    expect(
      isExpectedListenTogetherPlayCancellation({ name: "AbortError" }, true),
    ).toBe(true);
    expect(
      isExpectedListenTogetherPlayCancellation({ name: "AbortError" }, false),
    ).toBe(false);
    expect(
      isExpectedListenTogetherPlayCancellation(
        { name: "NotAllowedError" },
        true,
      ),
    ).toBe(false);
  });

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

  it("uses direct stream URL for radio tracks", () => {
    const radioSnapshot = makeRadioSnapshot();
    const plan = getListenTogetherPlaybackPlan({
      snapshot: radioSnapshot,
      playback: {
        src: null,
        currentTimeMs: 0,
        paused: true,
      },
      streamUrl: "https://stream.example.com/live",
    });

    expect(plan.nextSrc).toBe("https://stream.example.com/live");
    expect(plan.shouldLoad).toBe(true);
    expect(plan.shouldPlay).toBe(true);
  });

  it("does not seek for radio tracks", () => {
    const radioSnapshot = makeRadioSnapshot({ positionMs: 50_000 });
    const plan = getListenTogetherPlaybackPlan({
      snapshot: radioSnapshot,
      playback: {
        src: "https://stream.example.com/live",
        currentTimeMs: 10_000,
        paused: false,
      },
      streamUrl: "https://stream.example.com/live",
    });

    expect(plan.seekToMs).toBeNull();
    expect(plan.shouldLoad).toBe(false);
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

describe("listen together playback recovery", () => {
  const fresh = { transientRetries: 0, formatSwitched: false };

  it("retries YouTube's bot wall after the route's Retry-After, with backoff", () => {
    const first = planListenTogetherPlaybackRecovery({
      mediaErrorCode: 4,
      probe: { status: 503, retryAfterSeconds: 20 },
      state: fresh,
      canTryAlternateFormat: true,
    });
    expect(first).toMatchObject({ action: "retry", delayMs: 20_000 });
    expect(first.error.code).toBe("PLAYBACK_RETRYING");
    expect(first.error.message).toContain("Retrying in 20s");

    const second = planListenTogetherPlaybackRecovery({
      mediaErrorCode: 4,
      probe: { status: 503, retryAfterSeconds: 20 },
      state: { transientRetries: 1, formatSwitched: false },
      canTryAlternateFormat: true,
    });
    expect(second.delayMs).toBe(40_000);
  });

  it("gives up on the wall after the retry budget, without switching formats", () => {
    const plan = planListenTogetherPlaybackRecovery({
      mediaErrorCode: 4,
      probe: { status: 503, retryAfterSeconds: null },
      state: {
        transientRetries: LISTEN_TOGETHER_MAX_TRANSIENT_RETRIES,
        formatSwitched: false,
      },
      canTryAlternateFormat: true,
    });
    expect(plan.action).toBe("fail");
    expect(plan.error.code).toBe("PLAYBACK_UNAVAILABLE");
  });

  it("switches container only when the route serves the stream but the element cannot decode it", () => {
    expect(
      planListenTogetherPlaybackRecovery({
        mediaErrorCode: 4,
        probe: { status: 200, retryAfterSeconds: null },
        state: fresh,
        canTryAlternateFormat: true,
      }).action,
    ).toBe("switch-format");

    const exhausted = planListenTogetherPlaybackRecovery({
      mediaErrorCode: 3,
      probe: { status: 200, retryAfterSeconds: null },
      state: { transientRetries: 0, formatSwitched: true },
      canTryAlternateFormat: true,
    });
    expect(exhausted.action).toBe("fail");
    expect(exhausted.error.code).toBe("PLAYBACK_SRC_NOT_SUPPORTED");

    expect(
      planListenTogetherPlaybackRecovery({
        mediaErrorCode: 4,
        probe: { status: 200, retryAfterSeconds: null },
        state: fresh,
        canTryAlternateFormat: false,
      }).action,
    ).toBe("fail");
  });

  it("asks to rejoin voice when the route refuses the session", () => {
    const plan = planListenTogetherPlaybackRecovery({
      mediaErrorCode: 4,
      probe: { status: 403, retryAfterSeconds: null },
      state: fresh,
      canTryAlternateFormat: true,
    });
    expect(plan.action).toBe("fail");
    expect(plan.error.code).toBe("PLAYBACK_SESSION");
  });

  it("tries the other container once for a 502, then names the track as unplayable", () => {
    expect(
      planListenTogetherPlaybackRecovery({
        mediaErrorCode: 4,
        probe: { status: 502, retryAfterSeconds: null },
        state: fresh,
        canTryAlternateFormat: true,
      }).action,
    ).toBe("switch-format");
    const plan = planListenTogetherPlaybackRecovery({
      mediaErrorCode: 4,
      probe: { status: 502, retryAfterSeconds: null },
      state: { transientRetries: 0, formatSwitched: true },
      canTryAlternateFormat: true,
    });
    expect(plan.error.code).toBe("PLAYBACK_UNAVAILABLE");
    expect(plan.error.message).not.toContain("multiple supported");
  });

  it("reconnects when the route itself was unreachable", () => {
    const plan = planListenTogetherPlaybackRecovery({
      mediaErrorCode: 2,
      probe: null,
      state: fresh,
      canTryAlternateFormat: true,
    });
    expect(plan).toMatchObject({ action: "retry", delayMs: 3_000 });
  });

  it("does not trust a platform that answers canPlayType with nothing", () => {
    // jsdom answers "" for every type.
    expect(shouldTryAlternateListenTogetherFormat("mp4")).toBe(true);
  });

  it("does not switch to a container the platform says it cannot play", () => {
    const spy = vi
      .spyOn(HTMLMediaElement.prototype, "canPlayType")
      .mockImplementation((type: string) =>
        type.startsWith("audio/mp4") ? "probably" : "",
      );
    try {
      expect(shouldTryAlternateListenTogetherFormat("mp4")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("probes the stream with HEAD and reads Retry-After", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 503, headers: { "Retry-After": "12" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        probeListenTogetherStream(
          "https://meet.example/api/listen-together/stream?videoId=v",
        ),
      ).resolves.toEqual({ status: 503, retryAfterSeconds: 12 });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://meet.example/api/listen-together/stream?videoId=v",
        expect.objectContaining({ method: "HEAD" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports an unreachable route as a null probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    try {
      await expect(probeListenTogetherStream("/api/x")).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
