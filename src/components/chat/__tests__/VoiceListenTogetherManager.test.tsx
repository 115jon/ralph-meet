// @vitest-environment jsdom

import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useListenTogetherAudioSettingsStore } from "@/stores/useListenTogetherAudioSettingsStore";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceListenTogetherManager } from "../VoiceListenTogetherManager";

class MockAudio extends EventTarget {
  public static instances: MockAudio[] = [];
  public static playPromises: Promise<void>[] = [];

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
    const pendingPlay = MockAudio.playPromises.shift();
    if (pendingPlay) await pendingPlay;
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
    MockAudio.playPromises = [];
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

  it("ignores malformed snapshot events without disrupting the room", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      voiceGW: { sendAppEvent: vi.fn() },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() => expect(listeners.has("app-event")).toBe(true));
    const snapshotBefore =
      useListenTogetherStore.getState().rooms["room-1"]?.snapshot;

    act(() => {
      listeners.get("app-event")?.({
        type: "listen_together.snapshot",
        room_slug: "room-1",
        snapshot: { ...makeSnapshot(), queue: null },
      });
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      snapshotBefore,
    );

    act(() => {
      listeners.get("app-event")?.({
        type: "listen_together.snapshot",
        room_slug: "room-1",
        snapshot: {
          ...makeSnapshot(),
          currentEntry: { ...makeSnapshot().currentEntry!, track: {} },
        },
      });
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      snapshotBefore,
    );

    act(() => {
      listeners.get("app-event")?.(null);
    });

    act(() => {
      listeners.get("app-event")?.({
        type: "listen_together.snapshot",
        room_slug: "room-1",
        snapshot: {
          ...makeSnapshot(),
          queue: [{ ...makeSnapshot().queue[0]!, track: {} }],
        },
      });
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      snapshotBefore,
    );

    act(() => {
      listeners.get("app-event")?.({
        type: "listen_together.snapshot",
        room_slug: "room-1",
        snapshot: {
          ...makeSnapshot(),
          recentlyPlayed: [
            {
              historyId: "history-1",
              playedAt: 1_000,
              entry: { ...makeSnapshot().queue[0]!, track: {} },
            },
          ],
        },
      });
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      snapshotBefore,
    );

    act(() => {
      listeners.get("app-event")?.({
        type: "listen_together.snapshot",
        room_slug: "room-1",
        snapshot: {
          ...makeSnapshot(),
          currentEntry: null,
          currentEntryId: null,
          paused: false,
          anchorPositionMs: 500,
          positionMs: 500,
          durationMs: null,
        },
      });
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.snapshot).toBe(
      snapshotBefore,
    );
  });

  it("applies fallback details for an inbound room error event", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      voiceGW: { sendAppEvent: vi.fn() },
    };

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() => expect(listeners.has("app-event")).toBe(true));
    act(() => {
      listeners.get("app-event")?.({
        type: "listen_together.error",
        room_slug: "room-1",
      });
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
      code: "UNKNOWN",
      message: "Listen Together error",
    });
  });

  it("clears optimistic playback state when voice reconnects", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sfu = {
      on: vi.fn((event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      }),
      voiceGW: { sendAppEvent: vi.fn() },
    };
    useListenTogetherStore.setState({
      rooms: {
        "room-1": {
          snapshot: makeSnapshot(),
          localVolume: 1,
          localPlayback: {
            paused: true,
            positionMs: 1_000,
            entryId: "entry-1",
            snapshotRevision: 1,
            source: "command",
            accepted: true,
          },
          error: null,
        },
      },
    });

    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    act(() => listeners.get("voice-ready")?.({}));

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toBeNull();
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

    act(() => {
      listeners.get("voice-ready")?.({});
    });

    musicAudio.play.mockClear();
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

  it("replaces a music source, pauses the old playback, seeks, and follows successor play/pause state", async () => {
    const sfu = makeSfu();
    const { rerender } = render(
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
    await waitFor(() => expect(musicAudio.src).toContain("videoId=video-1"));
    musicAudio.paused = false;
    musicAudio.currentTime = 12;
    musicAudio.play.mockClear();
    musicAudio.pause.mockClear();

    const successor = makeSnapshot();
    const successorEntry = {
      ...successor.currentEntry!,
      entryId: "entry-2",
      track: {
        ...successor.currentEntry!.track,
        id: "track-2",
        videoId: "video-2",
        title: "Track Two",
      },
    };
    act(() => {
      useListenTogetherStore.getState().setSnapshot("room-1", {
        ...successor,
        revision: 2,
        paused: false,
        currentEntryId: successorEntry.entryId,
        currentEntry: successorEntry,
        queue: [successorEntry],
        positionMs: 4_000,
        lastUpdatedAt: 2_000,
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
      expect(musicAudio.src).toContain("videoId=video-2");
      expect(musicAudio.pause).toHaveBeenCalled();
      expect(musicAudio.currentTime).toBe(4);
      expect(musicAudio.play).toHaveBeenCalled();
    });

    act(() => {
      useListenTogetherStore.getState().setSnapshot("room-1", {
        ...successor,
        revision: 3,
        paused: true,
        currentEntryId: successorEntry.entryId,
        currentEntry: successorEntry,
        queue: [successorEntry],
        positionMs: 6_000,
        lastUpdatedAt: 3_000,
      });
    });
    rerender(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );

    await waitFor(() => expect(musicAudio.pause).toHaveBeenCalledTimes(2));
  });

  it("ignores late inactive audio events after switching tracks", async () => {
    const sfu = makeSfu();
    const { rerender } = render(
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
    const radioSnapshot = makeSnapshot();
    const radioEntry = {
      ...radioSnapshot.currentEntry!,
      entryId: "radio-entry-1",
      track: {
        kind: "radio" as const,
        id: "radio-1",
        provider: "radio" as const,
        title: "Radio One",
        artist: null,
        artworkUrl: null,
        canonicalUrl: "https://radio.example.com",
        streamUrl: "https://radio.example.com/live",
        sourceLabel: "Radio",
      },
    };
    act(() => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": {
            snapshot: {
              ...radioSnapshot,
              revision: 2,
              currentEntryId: radioEntry.entryId,
              currentEntry: radioEntry,
              queue: [radioEntry],
              lastUpdatedAt: 2_000,
            },
            localVolume: 1,
            error: null,
          },
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
    await waitFor(() =>
      expect(MockAudio.instances[1]?.src).toBe(
        "https://radio.example.com/live",
      ),
    );

    musicAudio.error = { code: 4 };
    musicAudio.dispatchEvent(new Event("error"));
    musicAudio.dispatchEvent(new Event("canplay"));
    musicAudio.dispatchEvent(new Event("waiting"));
    musicAudio.dispatchEvent(new Event("stalled"));
    musicAudio.dispatchEvent(new Event("ended"));

    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toBeNull();
    expect(MockAudio.instances[1]?.src).toBe("https://radio.example.com/live");
  });

  it("ignores a stale deferred play rejection after replacing the current source", async () => {
    let rejectOldPlay!: (reason: unknown) => void;
    MockAudio.playPromises = [
      new Promise<void>((_, reject) => {
        rejectOldPlay = reject;
      }),
    ];
    const sfu = makeSfu();
    const { rerender } = render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );
    const musicAudio = await waitFor(() => {
      const audio = MockAudio.instances[0];
      expect(audio).toBeDefined();
      expect(audio.play).toHaveBeenCalledTimes(1);
      return audio;
    });

    const successor = makeSnapshot();
    const successorEntry = {
      ...successor.currentEntry!,
      entryId: "entry-2",
      track: { ...successor.currentEntry!.track, videoId: "video-2" },
    };
    act(() => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": {
            snapshot: {
              ...successor,
              revision: 2,
              currentEntryId: successorEntry.entryId,
              currentEntry: successorEntry,
              queue: [successorEntry],
              lastUpdatedAt: 2_000,
            },
            localVolume: 1,
            error: { code: "SUCCESSOR_ERROR", message: "successor error" },
          },
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
    await waitFor(() => expect(musicAudio.play).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectOldPlay(new Error("stale play rejection"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
      code: "SUCCESSOR_ERROR",
      message: "successor error",
    });
  });

  it("reports a current deferred play rejection as PLAYBACK_BLOCKED", async () => {
    let rejectPlay!: (reason: unknown) => void;
    MockAudio.playPromises = [
      new Promise<void>((_, reject) => {
        rejectPlay = reject;
      }),
    ];
    const sfu = makeSfu();
    render(
      <VoiceListenTogetherManager
        sfu={sfu as never}
        roomSlug="room-1"
        voiceSessionId="voice-session-1"
      />,
    );
    await waitFor(() =>
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled(),
    );

    act(() => rejectPlay(new Error("autoplay blocked")));

    await waitFor(() =>
      expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
        code: "PLAYBACK_BLOCKED",
        message: "autoplay blocked",
      }),
    );
  });

  it("reports PLAYBACK_SRC_NOT_SUPPORTED after the alternate format also fails", async () => {
    const sfu = makeSfu();
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

    musicAudio.error = { code: 4 };
    act(() => musicAudio.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.error?.code,
      ).toBe("PLAYBACK_RETRYING"),
    );

    musicAudio.error = { code: 4 };
    act(() => musicAudio.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
        code: "PLAYBACK_SRC_NOT_SUPPORTED",
        message:
          "Playback failed after trying multiple supported audio formats.",
      }),
    );
  });

  it("allows a later transient error after canplay has reset the retry key", async () => {
    const sfu = makeSfu();
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

    musicAudio.error = { code: 4 };
    act(() => musicAudio.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.error?.code,
      ).toBe("PLAYBACK_RETRYING"),
    );

    act(() => musicAudio.dispatchEvent(new Event("canplay")));
    await waitFor(() =>
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.error,
      ).toBeNull(),
    );

    act(() => musicAudio.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.error?.code,
      ).toBe("PLAYBACK_RETRYING"),
    );
  });

  it("does not clear a non-playback room error on canplay", async () => {
    const sfu = makeSfu();
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

    act(() => {
      useListenTogetherStore.getState().setError("room-1", {
        code: "RADIO_UNAVAILABLE",
        message: "Radio unavailable",
      });
      musicAudio.dispatchEvent(new Event("canplay"));
    });

    expect(useListenTogetherStore.getState().rooms["room-1"]?.error).toEqual({
      code: "RADIO_UNAVAILABLE",
      message: "Radio unavailable",
    });
  });

  it("scopes retry keys to consecutive queue entries using the same track", async () => {
    const sfu = makeSfu();
    const { rerender } = render(
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
    musicAudio.error = { code: 4 };
    act(() => musicAudio.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.error?.code,
      ).toBe("PLAYBACK_RETRYING"),
    );

    const next = makeSnapshot();
    const nextEntry = { ...next.currentEntry!, entryId: "entry-2" };
    act(() => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": {
            snapshot: {
              ...next,
              revision: 2,
              currentEntryId: nextEntry.entryId,
              currentEntry: nextEntry,
              queue: [nextEntry],
              lastUpdatedAt: 2_000,
            },
            localVolume: 1,
            error: null,
          },
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
    await waitFor(() => expect(musicAudio.src).toContain("videoId=video-1"));

    act(() => musicAudio.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(
        useListenTogetherStore.getState().rooms["room-1"]?.error?.code,
      ).toBe("PLAYBACK_RETRYING"),
    );
  });

  it("does not clear a successor override from a delayed native pause callback", async () => {
    const sendAppEvent = vi.fn();
    const sfu = { ...makeSfu(), voiceGW: { sendAppEvent } };
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
    act(() => musicAudio.dispatchEvent(new Event("pause")));
    const successor = makeSnapshot();
    const successorEntry = {
      ...successor.currentEntry!,
      entryId: "entry-2",
      track: { ...successor.currentEntry!.track, title: "Track Two" },
    };
    act(() => {
      useListenTogetherStore.setState({
        rooms: {
          "room-1": {
            snapshot: {
              ...successor,
              revision: 2,
              currentEntryId: successorEntry.entryId,
              currentEntry: successorEntry,
              queue: [successorEntry],
              lastUpdatedAt: 2_000,
            },
            localVolume: 1,
            localPlayback: {
              paused: true,
              positionMs: 2_000,
              entryId: successorEntry.entryId,
              snapshotRevision: 2,
              source: "command",
              accepted: true,
            },
            error: null,
          },
        },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(
      useListenTogetherStore.getState().rooms["room-1"]?.localPlayback,
    ).toMatchObject({ entryId: successorEntry.entryId, source: "command" });
  });
});
