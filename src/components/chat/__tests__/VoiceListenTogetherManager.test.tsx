// @vitest-environment jsdom

import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceListenTogetherManager } from "../VoiceListenTogetherManager";

class MockAudio extends EventTarget {
  public static instances: MockAudio[] = [];

  public preload = "";
  public crossOrigin: string | null = null;
  public volume = 1;
  public currentTime = 0;
  public paused = true;
  public error: { code: number } | null = null;

  private currentSrc = "";

  constructor() {
    super();
    MockAudio.instances.push(this);
  }

  get src() {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
  }

  play = vi.fn(async () => {
    this.paused = false;
  });

  pause = vi.fn(() => {
    this.paused = true;
  });

  load = vi.fn(() => {});

  removeAttribute = vi.fn((name: string) => {
    if (name === "src") {
      this.currentSrc = "";
    }
  });
}

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
  };
}

function makeSfu() {
  return {
    on: vi.fn(() => vi.fn()),
    voiceGW: {
      sendAppEvent: vi.fn(),
    },
  };
}

describe("VoiceListenTogetherManager", () => {
  beforeEach(() => {
    vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
    MockAudio.instances = [];
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: makeSnapshot(),
          localVolume: 1,
          error: null,
        },
      },
    });
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    localStorage.setItem("desktop_auth_token", "desktop-token-1");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useListenTogetherStore.setState({ rooms: {} });
    localStorage.clear();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("refreshes the audio stream src when the desktop auth token changes", async () => {
    const sfu = makeSfu();

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() => {
      expect(MockAudio.instances).toHaveLength(1);
      expect(MockAudio.instances[0]?.src).toContain("token=desktop-token-1");
    });

    act(() => {
      localStorage.setItem("desktop_auth_token", "desktop-token-2");
      window.dispatchEvent(new CustomEvent("ralphmeet:desktop-token-change", {
        detail: "desktop-token-2",
      }));
    });

    await waitFor(() => {
      expect(MockAudio.instances[0]?.src).toContain("token=desktop-token-2");
    });
  });

  it("uses anonymous CORS mode for desktop audio before assigning the stream", async () => {
    const sfu = makeSfu();

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() => {
      expect(MockAudio.instances[0]?.crossOrigin).toBe("anonymous");
    });
  });

  it("refreshes the audio stream src when the voice session id changes", async () => {
    const sfu = makeSfu();

    const { rerender } = render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() => {
      expect(MockAudio.instances[0]?.src).toContain("sessionId=voice-session-1");
    });

    rerender(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-2"
      />,
    );

    await waitFor(() => {
      expect(MockAudio.instances[0]?.src).toContain("sessionId=voice-session-2");
    });
  });
});
