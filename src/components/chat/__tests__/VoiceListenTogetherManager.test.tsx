// @vitest-environment jsdom

import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useListenTogetherAudioSettingsStore } from "@/stores/useListenTogetherAudioSettingsStore";
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
  public ended = false;
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
    (
      window as typeof window & { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    localStorage.setItem("desktop_auth_token", "desktop-token-1");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useListenTogetherStore.setState({ rooms: {} });
    localStorage.clear();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
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
      expect(MockAudio.instances).toHaveLength(2);
      expect(MockAudio.instances[0]?.src).toContain("token=desktop-token-1");
    });

    act(() => {
      localStorage.setItem("desktop_auth_token", "desktop-token-2");
      window.dispatchEvent(
        new CustomEvent("ralphmeet:desktop-token-change", {
          detail: "desktop-token-2",
        }),
      );
    });

    await waitFor(() => {
      expect(MockAudio.instances[0]?.src).toContain("token=desktop-token-2");
    });
  });

  it("uses anonymous CORS mode for music tracks to enable audio processing", async () => {
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

  it("plays radio tracks with direct streamUrl without requiring voiceSessionId", async () => {
    const sfu = makeSfu();
    const radioSnapshot: ListenTogetherStateSnapshot = {
      roomSlug: "room-1",
      revision: 1,
      paused: false,
      currentEntryId: "radio-entry-1",
      anchorPositionMs: 0,
      anchorUpdatedAt: 1_000,
      lastUpdatedAt: 1_000,
      queue: [
        {
          entryId: "radio-entry-1",
          requestedAt: 1_000,
          requester: {
            userId: "user-1",
            displayName: "Alice",
            avatarUrl: null,
            avatarDisplay: null,
          },
          track: {
            kind: "radio",
            id: "radio-station-1",
            provider: "radio",
            title: "Rock FM",
            artist: null,
            artworkUrl: null,
            canonicalUrl: "https://radio.example.com",
            streamUrl: "https://stream.radio.example.com/live.mp3",
            sourceLabel: "Radio",
          },
        },
      ],
      currentEntry: {
        entryId: "radio-entry-1",
        requestedAt: 1_000,
        requester: {
          userId: "user-1",
          displayName: "Alice",
          avatarUrl: null,
          avatarDisplay: null,
        },
        track: {
          kind: "radio",
          id: "radio-station-1",
          provider: "radio",
          title: "Rock FM",
          artist: null,
          artworkUrl: null,
          canonicalUrl: "https://radio.example.com",
          streamUrl: "https://stream.radio.example.com/live.mp3",
          sourceLabel: "Radio",
        },
      },
      positionMs: 0,
      durationMs: null,
    };

    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: radioSnapshot,
          localVolume: 1,
          error: null,
        },
      },
    });

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId={null}
      />,
    );

    await waitFor(() => {
      expect(MockAudio.instances[1]?.src).toBe(
        "https://stream.radio.example.com/live.mp3",
      );
      expect(MockAudio.instances[1]?.crossOrigin).toBe(null);
    });
  });

  it("keeps the music graph on its dedicated element while radio plays natively", async () => {
    const context = {
      currentTime: 0,
      destination: {},
      createMediaElementSource: vi.fn(() => {
        if (context.createMediaElementSource.mock.calls.length > 1) {
          throw new Error("A media element can only have one source node");
        }
        return { connect: vi.fn(), disconnect: vi.fn() };
      }),
      createDynamicsCompressor: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        threshold: { value: 0, setTargetAtTime: vi.fn() },
        knee: { value: 0, setTargetAtTime: vi.fn() },
        ratio: { value: 0, setTargetAtTime: vi.fn() },
        attack: { value: 0, setTargetAtTime: vi.fn() },
        release: { value: 0, setTargetAtTime: vi.fn() },
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 0, setTargetAtTime: vi.fn() },
      })),
    };
    const sfu = {
      ...makeSfu(),
      audio: { getAudioContext: vi.fn(() => context) },
      resumeAudioContext: vi.fn(),
    };
    vi.stubGlobal("AudioContext", class {});
    useListenTogetherAudioSettingsStore.setState({ enabled: true });
    const { rerender } = render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() =>
      expect(context.createMediaElementSource).toHaveBeenCalledTimes(1),
    );
    const radioSnapshot = makeSnapshot();
    const radioTrack = {
      kind: "radio" as const,
      id: "radio-1",
      provider: "radio" as const,
      title: "Radio",
      artist: null,
      artworkUrl: null,
      canonicalUrl: "https://radio.example.com",
      streamUrl: "https://stream.radio.example.com/live.mp3",
      sourceLabel: "Radio",
    };
    radioSnapshot.currentEntry = {
      ...radioSnapshot.currentEntry!,
      track: radioTrack,
    };
    radioSnapshot.queue = [radioSnapshot.currentEntry];
    await act(async () => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": { snapshot: radioSnapshot, localVolume: 0.4, error: null },
        },
      });
    });
    rerender(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId={null}
      />,
    );

    await waitFor(() => {
      expect(MockAudio.instances).toHaveLength(2);
      expect(MockAudio.instances[1]?.src).toBe(
        "https://stream.radio.example.com/live.mp3",
      );
      expect(MockAudio.instances[1]?.crossOrigin).toBe(null);
      expect(MockAudio.instances[1]?.volume).toBe(0.4);
    });

    await act(async () => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": { snapshot: makeSnapshot(), localVolume: 0.4, error: null },
        },
      });
    });
    rerender(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );
    await waitFor(() => {
      expect(MockAudio.instances[0]?.src).toContain("listen-together");
      expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
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
      expect(MockAudio.instances[0]?.src).toContain(
        "sessionId=voice-session-1",
      );
    });

    rerender(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-2"
      />,
    );

    await waitFor(() => {
      expect(MockAudio.instances[0]?.src).toContain(
        "sessionId=voice-session-2",
      );
    });
  });

  it("requests authoritative playback state when voice reconnects", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sendAppEvent = vi.fn();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      voiceGW: { sendAppEvent },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() => {
      expect(sendAppEvent).toHaveBeenCalledWith({
        type: "listen_together.state.request",
        room_slug: "room-1",
      });
    });
    sendAppEvent.mockClear();

    act(() => {
      listeners.get("voice-ready")?.({});
    });

    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "listen_together.state.request",
      room_slug: "room-1",
    });
  });

  it("sends native pause events to shared playback and does not resume on refresh", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sendAppEvent = vi.fn();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      voiceGW: { sendAppEvent },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    const musicAudio = await waitFor(() => {
      const audio = MockAudio.instances[0];
      expect(audio).toBeDefined();
      return audio;
    });
    musicAudio.paused = true;
    sendAppEvent.mockClear();
    act(() => musicAudio.dispatchEvent(new Event("pause")));

    await waitFor(() =>
      expect(sendAppEvent).toHaveBeenCalledWith({
        type: "listen_together.pause",
        room_slug: "room-1",
        paused: true,
        entryId: "entry-1",
      }),
    );

    musicAudio.play.mockClear();
    act(() => {
      listeners.get("voice-ready")?.({});
    });

    await waitFor(() => expect(musicAudio.play).not.toHaveBeenCalled());

    const pausedSnapshot = { ...makeSnapshot(), paused: true };
    act(() => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": {
            snapshot: pausedSnapshot,
            localVolume: 1,
            error: null,
          },
        },
      });
    });
    await waitFor(() =>
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.snapshot?.paused,
      ).toBe(true),
    );

    act(() => {
      musicAudio.paused = false;
      sendAppEvent.mockClear();
      musicAudio.dispatchEvent(new Event("play"));
    });

    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "listen_together.pause",
      room_slug: "room-1",
      paused: false,
      entryId: "entry-1",
    });
  });

  it("does not broadcast a pause when the current track ends naturally", async () => {
    const sendAppEvent = vi.fn();
    const sfu = {
      ...makeSfu(),
      voiceGW: { sendAppEvent },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    const musicAudio = await waitFor(() => {
      const audio = MockAudio.instances[0];
      expect(audio).toBeDefined();
      return audio;
    });
    musicAudio.currentTime = 180;
    musicAudio.paused = true;
    musicAudio.ended = true;
    sendAppEvent.mockClear();

    act(() => musicAudio.dispatchEvent(new Event("pause")));

    expect(sendAppEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "listen_together.pause" }),
    );
  });

  it("suppresses a boundary pause when an ended event follows", async () => {
    const sendAppEvent = vi.fn();
    const sfu = {
      ...makeSfu(),
      voiceGW: { sendAppEvent },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    const musicAudio = await waitFor(() => {
      const audio = MockAudio.instances[0];
      expect(audio).toBeDefined();
      return audio;
    });
    musicAudio.currentTime = 180;
    musicAudio.paused = true;
    musicAudio.ended = false;
    sendAppEvent.mockClear();

    act(() => {
      musicAudio.dispatchEvent(new Event("pause"));
      musicAudio.ended = true;
      musicAudio.dispatchEvent(new Event("ended"));
    });
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(sendAppEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "listen_together.pause" }),
    );
  });

  it("broadcasts an intentional pause near the end before ended is true", async () => {
    const sendAppEvent = vi.fn();
    const sfu = {
      ...makeSfu(),
      voiceGW: { sendAppEvent },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    const musicAudio = await waitFor(() => {
      const audio = MockAudio.instances[0];
      expect(audio).toBeDefined();
      return audio;
    });
    musicAudio.currentTime = 179.5;
    musicAudio.paused = true;
    musicAudio.ended = false;
    sendAppEvent.mockClear();

    act(() => musicAudio.dispatchEvent(new Event("pause")));
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(sendAppEvent).toHaveBeenCalledWith({
      type: "listen_together.pause",
      room_slug: "room-1",
      paused: true,
      entryId: "entry-1",
    });
  });

  it("does not apply a deferred pause to a successor track", async () => {
    const sendAppEvent = vi.fn();
    const sfu = {
      ...makeSfu(),
      voiceGW: { sendAppEvent },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    const musicAudio = await waitFor(() => {
      const audio = MockAudio.instances[0];
      expect(audio).toBeDefined();
      return audio;
    });
    musicAudio.paused = true;
    musicAudio.ended = false;
    sendAppEvent.mockClear();

    act(() => musicAudio.dispatchEvent(new Event("pause")));
    const successorSnapshot = makeSnapshot();
    const successorEntry = {
      ...successorSnapshot.currentEntry!,
      entryId: "entry-2",
      track: {
        ...successorSnapshot.currentEntry!.track,
        id: "track-2",
        videoId: "video-2",
        title: "Track Two",
      },
    };
    act(() => {
      useListenTogetherStore.getState().setSnapshot("room-1", {
        ...successorSnapshot,
        revision: 2,
        currentEntryId: successorEntry.entryId,
        currentEntry: successorEntry,
        queue: [successorEntry],
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(sendAppEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "listen_together.pause" }),
    );
  });

  it("preserves an intentional pause across an unpaused snapshot refresh", async () => {
    const sendAppEvent = vi.fn();
    const sfu = {
      ...makeSfu(),
      voiceGW: { sendAppEvent },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    const musicAudio = await waitFor(() => {
      const audio = MockAudio.instances[0];
      expect(audio).toBeDefined();
      return audio;
    });
    musicAudio.paused = true;
    musicAudio.ended = false;
    sendAppEvent.mockClear();

    act(() => musicAudio.dispatchEvent(new Event("pause")));
    act(() => {
      useListenTogetherStore
        .getState()
        .setSnapshot("room-1", { ...makeSnapshot(), revision: 2 });
    });

    await waitFor(() =>
      expect(sendAppEvent).toHaveBeenCalledWith({
        type: "listen_together.pause",
        room_slug: "room-1",
        paused: true,
        entryId: "entry-1",
      }),
    );
  });
});
