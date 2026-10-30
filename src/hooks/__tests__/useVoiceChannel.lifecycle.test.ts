// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCameraBackgroundEffect,
  getCameraBackgroundEffectKey,
  type CameraBackgroundEffect,
} from "@/lib/camera-background-effects";
import {
  acquireLocalStream,
  cancelPendingLocalStreamAcquisition,
  createLocalMediaOwner,
  startEarlyMic,
} from "@/lib/local-media-manager";
import {
  createLocalAudioGate,
  createLocalAudioProcessor,
  type LocalAudioGateController,
  type LocalAudioProcessorHandle,
} from "@/lib/voice/noise-reduction";

const {
  authUser,
  chatState,
  chatActions,
  settingsState,
  sfuInstances,
  FakeSFUClient,
} = vi.hoisted(() => {
  const sfuInstances: FakeSFUClient[] = [];

  class FakeSFUClient {
    readonly handlers = new Map<string, Set<(value: unknown) => void>>();
    readonly audio = {
      isAudioSuspended: () => false,
      setMasterVolume: vi.fn(),
      setOutputDevice: vi.fn(),
    };
    activeGateController: LocalAudioGateController | null = null;
    readonly vad = {
      setGateController: vi.fn(
        (controller: LocalAudioGateController | null) => {
          this.activeGateController = controller;
        },
      ),
      enableNoiseGate: vi.fn(),
      disableNoiseGate: vi.fn(),
      setThreshold: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      triggerGate: vi.fn((gated: boolean) => {
        this.activeGateController?.setGated(gated);
      }),
    };
    readonly roomGW = {
      sendVoiceState: vi.fn(),
      send: vi.fn(),
      refreshProfile: vi.fn(),
    };
    readonly voiceGW = {
      isReady: true,
      send: vi.fn(),
      sendAppEvent: vi.fn(() => true),
    };
    participantId: string | null = null;
    readonly getParticipantId = vi.fn((): string | null => this.participantId);
    readonly connect = vi.fn();
    readonly resumeAudioContext = vi.fn();
    readonly disconnect = vi.fn();
    readonly waitForVoiceGatewayReady = vi.fn(() => Promise.resolve());
    readonly setParticipantVolume = vi.fn();
    readonly setTrackVolume = vi.fn();
    readonly setTrackPan = vi.fn();
    readonly setRemoteTrackSubscription = vi.fn();
    readonly setClerkMapping = vi.fn();
    readonly deleteClerkMapping = vi.fn();
    readonly publishedTracks = new Map<string, MediaStreamTrack>();
    readonly publishTracks = vi.fn(
      (stream: MediaStream, prefix: string): Promise<void> => {
        if (prefix === "cam") {
          for (const track of stream.getAudioTracks()) {
            this.publishedTracks.set(
              `cam-audio-self`,
              track.clone ? track.clone() : track,
            );
          }
        }
        return Promise.resolve();
      },
    );
    readonly publishTracksIf = vi.fn(
      async (
        stream: MediaStream,
        prefix: string,
        stillCurrent: () => boolean,
      ): Promise<boolean> => {
        if (!stillCurrent()) return false;
        await Promise.resolve();
        if (!stillCurrent()) return false;
        await this.publishTracks(stream, prefix);
        return true;
      },
    );
    readonly replaceTrack = vi.fn(
      (
        trackName: string,
        newTrack: MediaStreamTrack | null,
      ): Promise<boolean> => {
        if (newTrack) {
          this.publishedTracks.set(
            trackName,
            newTrack.clone ? newTrack.clone() : newTrack,
          );
        } else {
          this.publishedTracks.delete(trackName);
        }
        return Promise.resolve(true);
      },
    );
    readonly setPublishedTrackEnabled = vi.fn();
    readonly unpublishTrack = vi.fn();
    readonly unpublishTrackIfCurrent = vi.fn(
      async (
        trackName: string,
        expectedTrack: MediaStreamTrack,
      ): Promise<boolean> => {
        if (this.publishedTracks.get(trackName) !== expectedTrack) return false;
        this.publishedTracks.delete(trackName);
        return true;
      },
    );
    readonly replaceTrackIfCurrent = vi.fn(
      async (
        trackName: string,
        expectedTrack: MediaStreamTrack,
        newTrack: MediaStreamTrack | null,
      ): Promise<boolean> => {
        if (this.publishedTracks.get(trackName) !== expectedTrack) return false;
        if (newTrack) {
          this.publishedTracks.set(
            trackName,
            newTrack.clone ? newTrack.clone() : newTrack,
          );
        } else {
          this.publishedTracks.delete(trackName);
        }
        return true;
      },
    );
    readonly getPublishedTrack = vi.fn(
      (trackName: string): MediaStreamTrack | null =>
        this.publishedTracks.get(trackName) ?? null,
    );
    readonly getMicrophoneTrackName = vi.fn((): string | null => {
      for (const name of this.publishedTracks.keys()) {
        if (name.startsWith("cam-audio-")) return name;
      }
      return "cam-audio-self";
    });

    constructor() {
      sfuInstances.push(this);
    }

    on(event: string, handler: (value: unknown) => void): () => void {
      let handlers = this.handlers.get(event);
      if (!handlers) {
        handlers = new Set();
        this.handlers.set(event, handlers);
      }
      handlers.add(handler);
      return () => handlers?.delete(handler);
    }

    activeHandlerCount(): number {
      return Array.from(this.handlers.values()).reduce(
        (count, handlers) => count + handlers.size,
        0,
      );
    }

    joinedSnapshot: unknown = null;

    emit(event: string, value: unknown): void {
      if (event === "joined") this.joinedSnapshot = value;
      this.handlers.get(event)?.forEach((handler) => handler(value));
    }

    replayJoinedSnapshot(): boolean {
      if (!this.joinedSnapshot) return false;
      const snapshot = this.joinedSnapshot;
      this.joinedSnapshot = null;
      this.handlers.get("joined")?.forEach((handler) => handler(snapshot));
      return true;
    }

    promoteStandby(): void {
      this.roomGW.sendVoiceState({ promote_standby: true });
    }
  }

  const settings = {
    isMuted: false,
    isDeafened: false,
    inputDeviceId: "default",
    inputDeviceLabel: "",
    inputDeviceGroupId: "",
    videoDeviceId: "default",
    videoDeviceLabel: "",
    videoDeviceGroupId: "",
    cameraQuality: "720p30",
    cameraBackground: "none",
    customCameraBackgrounds: {},
    noiseSuppression: true,
    noiseReductionEnabled: false,
    noiseReductionProvider: "rnnoise",
    echoCancellation: true,
    autoSensitivity: true,
    sensitivity: -50,
    streamHighFidelity: false,
    inputProfile: "standard",
    outputVolume: 100,
    outputDeviceId: "default",
    spatialAudioEnabled: false,
    alwaysShowStreamPreview: false,
    peerSettings: {},
  };

  const settingsState = {
    getSettings: () => settings,
    setCurrentUser: vi.fn(),
    setIsMuted: vi.fn(),
    setIsDeafened: vi.fn(),
    setDevice: vi.fn(),
    updateUserSettings: vi.fn(),
  };

  const chatState = {
    voiceChannelStates: {} as Record<string, Array<Record<string, unknown>>>,
    voiceChannelSpatialAudioStates: {},
    user: null,
    connected: true,
    voiceChannelStartedAt: {},
    gateway: { getSessionId: () => null },
  };

  const authUser: { current: { id: string } | null } = { current: null };

  const chatActions = {
    dispatch: vi.fn(),
    sendVoiceChannelJoin: vi.fn(),
    sendVoiceChannelLeave: vi.fn(),
    sendVoiceStateUpdate: vi.fn(),
    setSpeakingUsers: vi.fn(),
    clearSpeakingUsers: vi.fn(),
  };

  return {
    chatState,
    chatActions,
    authUser,
    settingsState,
    sfuInstances,
    FakeSFUClient,
  };
});

vi.mock("@/lib/sfu-client", () => ({ SFUClient: FakeSFUClient }));
vi.mock("@kova/react", () => ({
  useUser: () => ({ user: authUser.current }),
}));
vi.mock("@/lib/console-logger", () => ({
  clog: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("@/lib/camera-background-effects", () => ({
  createCameraBackgroundEffect: vi.fn(),
  getCameraBackgroundEffectKey: vi.fn(() => "none"),
}));
vi.mock("@/lib/voice/standby-audio", () => ({
  createSilentAudioTrack: () => {
    const track = {
      id: "silence",
      kind: "audio",
      enabled: true,
      readyState: "live",
      stop: vi.fn(),
    };
    return {
      track,
      stream: { getAudioTracks: () => [track], getTracks: () => [track] },
      stop: vi.fn(() => track.stop()),
      pause: vi.fn(),
      resume: vi.fn(),
    };
  },
}));
vi.mock("@/lib/local-media-manager", () => ({
  acquireLocalStream: vi.fn(),
  cancelPendingLocalStreamAcquisition: vi.fn(),
  createLocalMediaOwner: vi.fn(() => ({})),
  releaseLocalStream: vi.fn(),
  startEarlyMic: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({
  getCapturePolicy: vi.fn(),
  isDesktop: () => false,
  isWgcCaptureAllowed: () => false,
}));
vi.mock("@/lib/reconnect-sound-guard", () => ({
  areReconnectSoundsSuppressed: () => false,
}));
vi.mock("@/lib/voice-disconnect-beacon", () => ({
  sendVoiceDisconnectBeacon: vi.fn(),
}));
vi.mock("@/lib/stream-watchers", () => ({
  applyStreamWatcherSnapshot: vi.fn((previous) => previous),
  buildStreamWatcherIdentities: vi.fn(),
  getStreamWatcherActivitySound: vi.fn(),
  isStreamWatcherSnapshotPayload: vi.fn(() => false),
  resolveWatchedStreamsWithPendingIntents: vi.fn((watchedStreams) => ({
    watchedStreams,
    pendingIntents: {},
  })),
}));
vi.mock("@/lib/voice-identity", () => ({
  resolveVoiceIdentity: vi.fn((primary, fallback) => ({
    name: primary?.display_name || primary?.name || fallback?.name || "Guest",
    avatarUrl: primary?.avatar_url ?? fallback?.avatar_url ?? null,
    avatarDisplay: primary?.avatar_display ?? fallback?.avatar_display ?? null,
  })),
}));
vi.mock("@/lib/voice/noise-reduction", () => ({
  createLocalAudioGate: vi.fn(),
  createLocalAudioProcessor: vi.fn(),
  isNoiseReductionProviderSupported: vi.fn(() => false),
  resolveCaptureAudioProcessing: vi.fn(() => ({
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  })),
  resolveLocalAudioProcessingMode: vi.fn(() => "passthrough"),
}));
vi.mock("@/lib/sounds", () => ({
  playConnected: vi.fn(),
  playDeafen: vi.fn(),
  playDisconnect: vi.fn(),
  playMute: vi.fn(),
  playScreenShareStart: vi.fn(),
  playScreenShareStop: vi.fn(),
  playStreamWatcherStart: vi.fn(),
  playStreamWatcherStop: vi.fn(),
  playUndeafen: vi.fn(),
  playUnmute: vi.fn(),
}));
vi.mock("@/lib/voice/auto-soundboard", () => ({
  cancelAutomaticSoundboardCleanup: vi.fn(),
  getAutomaticSoundboardSessionId: vi.fn(() => "session"),
  getAutomaticSoundboardSessionGeneration: vi.fn(() => 1),
  playAutomaticSoundboardTrigger: vi.fn().mockResolvedValue(undefined),
  resetAutomaticSoundboardSession: vi.fn(),
  scheduleAutomaticSoundboardCleanup: vi.fn(),
}));
vi.mock("@/lib/useMediaDevices", () => ({
  useMediaDevices: () => ({ hasMicrophone: true, hasCamera: false }),
}));
vi.mock("@/hooks/useNativeShareStats", () => ({
  useNativeShareStats: () => ({ isHookActive: false }),
}));
vi.mock("@/hooks/useSpatialAudioSync", () => ({
  useSpatialAudioSync: vi.fn(),
}));
vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) =>
    selector(chatState),
  useChatActions: () => chatActions,
}));
vi.mock("@/stores/useVoiceSettingsStore", () => {
  const useVoiceSettingsStore = (
    selector: (state: typeof settingsState) => unknown,
  ) => selector(settingsState);
  useVoiceSettingsStore.getState = () => settingsState;
  return { useVoiceSettingsStore };
});
vi.mock("@/stores/useSoundSettingsStore", () => ({
  useSoundSettingsStore: {
    getState: () => ({ getSettings: () => ({}) }),
  },
}));

import { mergeVoiceState, useVoiceChannel } from "@/hooks/useVoiceChannel";
import { resetVoiceStandbyForTests } from "@/lib/voice/voice-standby";
import { playAutomaticSoundboardTrigger } from "@/lib/voice/auto-soundboard";
import type { VoiceState, VoiceStateDelta } from "@/lib/types";

class TestMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    const index = this.tracks.indexOf(track);
    if (index !== -1) this.tracks.splice(index, 1);
  }
}

function createTrack(kind: "audio" | "video", deviceId: string) {
  const stop = vi.fn();
  const track = {
    enabled: true,
    getSettings: vi.fn(() => ({
      autoGainControl: true,
      deviceId,
      echoCancellation: true,
      groupId: `group-${deviceId}`,
      noiseSuppression: true,
    })),
    id: `${kind}-${deviceId}`,
    kind,
    label: `${kind}-${deviceId}`,
    readyState: "live" as MediaStreamTrackState,
    stop,
  } as unknown as MediaStreamTrack;
  (track as { clone: () => MediaStreamTrack }).clone = () =>
    createTrack(kind, `${deviceId}-clone`).track;
  return { stop, track };
}

function createStream(tracks: MediaStreamTrack[] = []): MediaStream {
  return new TestMediaStream(tracks) as unknown as MediaStream;
}

function createProcessor(
  preGateStream: MediaStream,
  publicationStream = preGateStream,
  monitorStream = preGateStream,
  gateController: LocalAudioGateController = {
    resume: vi.fn(),
    setGated: vi.fn(),
  },
): LocalAudioProcessorHandle {
  return {
    createMonitorStream: () => monitorStream,
    destroy: vi.fn(),
    gateController,
    mode: "passthrough",
    preGateStream,
    publicationStream,
    resume: vi.fn(),
  };
}

function createEffect(
  track: MediaStreamTrack,
  key: string,
): CameraBackgroundEffect {
  return {
    key,
    stop: vi.fn(),
    stream: createStream([track]),
    track,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useVoiceChannel SFU lifecycle", () => {
  beforeEach(() => {
    resetVoiceStandbyForTests();
    vi.clearAllMocks();
    vi.mocked(createLocalAudioGate).mockReset();
    vi.mocked(acquireLocalStream).mockReset();
    vi.mocked(cancelPendingLocalStreamAcquisition).mockReset();
    vi.mocked(createCameraBackgroundEffect).mockReset();
    vi.mocked(createLocalAudioProcessor).mockReset();
    vi.mocked(getCameraBackgroundEffectKey).mockReset();
    vi.mocked(getCameraBackgroundEffectKey).mockReturnValue("none");
    sfuInstances.length = 0;
    authUser.current = null;
    chatState.voiceChannelStates = {};
    settingsState.getSettings().isMuted = false;
    settingsState.getSettings().inputDeviceId = "default";
    settingsState.getSettings().videoDeviceId = "default";
    settingsState.getSettings().cameraQuality = "720p30";
    settingsState.getSettings().cameraBackground = "none";
    settingsState.getSettings().autoSensitivity = true;
    settingsState.getSettings().sensitivity = -50;
    vi.stubGlobal("MediaStream", TestMediaStream);
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) =>
      createProcessor(stream),
    );
  });

  it("merges legacy full updates over cached optional profile fields", () => {
    const cached: VoiceState = {
      id: "remote",
      clerk_user_id: "user-remote",
      name: "Cached Name",
      username: "cached-user",
      display_name: "Cached Display",
      avatar_url: "https://example.com/cached.png",
      avatar_display: "frame:cached",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
    };
    const legacyUpdate: VoiceState = {
      id: cached.id,
      clerk_user_id: cached.clerk_user_id,
      name: "Legacy Name",
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
    };
    const delta: VoiceStateDelta = {
      id: cached.id,
      clerk_user_id: cached.clerk_user_id,
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
    };

    expect(mergeVoiceState(cached, legacyUpdate)).toEqual({
      ...cached,
      ...legacyUpdate,
    });
    expect(mergeVoiceState(undefined, legacyUpdate)).toEqual(legacyUpdate);
    expect(mergeVoiceState(undefined, delta)).toBeNull();
  });

  it("publishes silence without joining, then promotes the warmed session", async () => {
    authUser.current = { id: "user-1" };
    chatState.voiceChannelStates = {
      channel: [
        {
          clerk_user_id: "other-user",
          name: "Other",
          connected: true,
        },
      ],
    };
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sfuInstances).toHaveLength(1);
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("Standby SFU was not created");
    expect(sfu.connect).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      "user-1",
      expect.any(String),
      null,
      undefined,
      expect.objectContaining({
        channelId: "channel",
        serverId: "server",
        standby: true,
      }),
    );
    expect(chatActions.sendVoiceChannelJoin).not.toHaveBeenCalled();
    expect(sfu.publishTracks).toHaveBeenCalledTimes(1);
    const published = sfu.publishTracks.mock.calls[0]?.[0] as MediaStream;
    expect(published.getAudioTracks()[0]?.id).toBe("silence");
    expect(published.getAudioTracks()[0]?.enabled).toBe(true);

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    expect(sfu.publishTracks).toHaveBeenCalledTimes(1);
    expect(sfu.disconnect).not.toHaveBeenCalled();
    expect(chatActions.sendVoiceChannelJoin).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current.handleJoin();
    });

    expect(sfuInstances).toHaveLength(1);
    expect(sfu.connect).toHaveBeenCalledTimes(1);
    expect(sfu.roomGW.sendVoiceState).toHaveBeenCalledWith({
      promote_standby: true,
    });
    expect(chatActions.sendVoiceChannelJoin).toHaveBeenCalledWith(
      "channel",
      false,
      null,
    );
  });

  it("does not open the live microphone while the standby session is warming", async () => {
    authUser.current = { id: "user-1" };
    chatState.voiceChannelStates = {
      channel: [
        {
          clerk_user_id: "other-user",
          name: "Other",
          connected: true,
        },
      ],
    };
    const mic = {
      id: "live-mic",
      kind: "audio",
      enabled: true,
      readyState: "live",
      stop: vi.fn(),
      getSettings: () => ({}),
    };
    vi.mocked(acquireLocalStream).mockResolvedValue({
      getAudioTracks: () => [mic],
      getVideoTracks: () => [],
      getTracks: () => [mic],
    } as unknown as MediaStream);
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("Standby SFU was not created");

    expect(acquireLocalStream).not.toHaveBeenCalled();
    expect(sfu.publishTracks).toHaveBeenCalledTimes(1);
    const published = sfu.publishTracks.mock.calls[0]?.[0] as MediaStream;
    expect(published.getAudioTracks()[0]?.id).toBe("silence");
    expect(published.getAudioTracks()[0]?.enabled).toBe(true);

    authUser.current = { id: "user-1" };
    chatState.user = {
      display_name: "Renamed",
      username: "renamed",
      avatar_url: "https://example.com/next.png",
      avatar_display: "frame:next",
    } as unknown as null;
    hook.rerender();
    await act(async () => {
      await Promise.resolve();
    });
    chatState.user = null;

    expect(sfu.disconnect).not.toHaveBeenCalled();
    expect(sfu.connect).toHaveBeenCalledTimes(1);
    expect(sfuInstances).toHaveLength(1);
  });

  it("passes the active voice gateway to automatic join and leave triggers", async () => {
    authUser.current = { id: "user-1" };
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );

    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });

    const automaticMock = vi.mocked(playAutomaticSoundboardTrigger);
    expect(automaticMock).toHaveBeenCalledWith(
      "join",
      "session",
      "server",
      expect.objectContaining({
        serverKey: "server",
        userId: "user-1",
      }),
    );

    await act(async () => {
      hook.result.current.handleLeave();
      await Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(automaticMock).toHaveBeenCalledWith(
      "leave",
      "session",
      "server",
      expect.objectContaining({
        serverKey: "server",
        userId: "user-1",
      }),
    );
    expect(sfu.disconnect).toHaveBeenCalledWith("user-leave");
    hook.unmount();
  });

  it("republishes and restores speaking after leave then join", async () => {
    authUser.current = { id: "user-1" };
    const firstTrack = createTrack("audio", "first-join-audio");
    const secondTrack = createTrack("audio", "second-join-audio");
    vi.mocked(acquireLocalStream)
      .mockResolvedValueOnce(createStream([firstTrack.track]))
      .mockResolvedValueOnce(createStream([secondTrack.track]));

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const firstSfu = sfuInstances[0];
    if (!firstSfu) throw new Error("SFU was not created");
    await act(async () => {
      firstSfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() =>
      expect(firstSfu.publishTracks).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(hook.result.current.joined).toBe(true));

    await act(async () => {
      hook.result.current.handleLeave();
      await Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await waitFor(() => expect(hook.result.current.joined).toBe(false));

    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const secondSfu = sfuInstances[1];
    if (!secondSfu) throw new Error("Second SFU was not created");
    await waitFor(() =>
      expect(secondSfu.publishTracks).toHaveBeenCalledTimes(1),
    );
    const republished = secondSfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(republished?.getAudioTracks()).toEqual([secondTrack.track]);

    await act(async () => {
      secondSfu.participantId = "self-2";
      secondSfu.emit("vad-speaking", {
        participantId: "self-2",
        isSpeaking: true,
      });
      secondSfu.emit("joined", { participantId: "self-2", participants: [] });
      secondSfu.emit("voice-ready", { speaking: {} });
    });
    await waitFor(() =>
      expect(hook.result.current.speakingUsers["user-1"]).toBe(true),
    );

    hook.unmount();
  });

  it("disconnects an SFU that is still connecting without sending an exit sound", async () => {
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      hook.result.current.handleLeave();
    });

    expect(sfu.disconnect).toHaveBeenCalledWith("user-leave");
    expect(playAutomaticSoundboardTrigger).not.toHaveBeenCalledWith(
      "leave",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    hook.unmount();
  });

  it("merges compact participant updates and forwards profile updates to the sidebar cache", async () => {
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    const participant = {
      id: "remote",
      clerk_user_id: "user-remote",
      name: "Cached Name",
      username: "cached-user",
      display_name: "Cached Display",
      avatar_url: "https://example.com/cached.png",
      avatar_display: "frame:cached",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
    } as const;

    await act(async () => {
      sfu.emit("joined", {
        participantId: "self",
        participants: [participant],
      });
    });
    await act(async () => {
      sfu.emit("voice-state-update", {
        participant: {
          id: participant.id,
          clerk_user_id: participant.clerk_user_id,
          self_mute: true,
          self_deaf: participant.self_deaf,
          self_stream: participant.self_stream,
          self_video: participant.self_video,
          suppress: false,
          tracks: [],
        },
        action: "update",
      });
    });

    expect(hook.result.current.gridItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "user-remote",
          name: "Cached Display",
          isMuted: true,
        }),
      ]),
    );

    await act(async () => {
      sfu.emit("profile-update", {
        participantId: "remote",
        name: "Updated Name",
        username: "updated-user",
        displayName: null,
        avatarUrl: null,
        avatarDisplay: null,
      });
    });

    expect(chatActions.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_MEMBER_PROFILE",
      userId: "user-remote",
      name: "Updated Name",
      username: "updated-user",
      display_name: null,
      avatar_url: null,
      avatar_display: null,
    });
    expect(hook.result.current.gridItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "user-remote",
          name: "Updated Name",
          avatar: undefined,
        }),
      ]),
    );
    hook.unmount();
  });

  it("refreshes the active SFU profile when the local gateway profile changes", async () => {
    authUser.current = { id: "user-1" };
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });

    window.dispatchEvent(
      new CustomEvent("chat-gateway-event", {
        detail: {
          event: "USER_PROFILE_UPDATE",
          data: {
            user_id: "user-1",
            avatar_url: "https://example.com/new.png",
            avatar_display: null,
          },
        },
      }),
    );

    expect(sfu.roomGW.refreshProfile).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("removes SFU handlers when a session is torn down and does not accumulate them on reconnect", async () => {
    const first = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );

    await act(async () => {
      await first.result.current.handleJoin();
    });
    await waitFor(() => expect(sfuInstances).toHaveLength(1));
    const firstSfu = sfuInstances[0];
    expect(firstSfu).toBeDefined();
    const baseline = firstSfu?.activeHandlerCount() ?? 0;
    expect(baseline).toBeGreaterThan(0);

    first.unmount();
    expect(firstSfu?.activeHandlerCount()).toBe(0);

    const second = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await second.result.current.handleJoin();
    });
    await waitFor(() => expect(sfuInstances).toHaveLength(2));

    expect(sfuInstances[1]?.activeHandlerCount()).toBe(baseline);
    second.unmount();
  });

  it("uses distinct LocalMediaManager owners for separate hook instances", async () => {
    const first = renderHook(() =>
      useVoiceChannel({ channelId: "channel-a", serverId: "server" }),
    );
    const second = renderHook(() =>
      useVoiceChannel({ channelId: "channel-b", serverId: "server" }),
    );

    await act(async () => {
      await first.result.current.handleJoin();
      await second.result.current.handleJoin();
    });

    const startEarlyMicMock = vi.mocked(startEarlyMic);
    expect(startEarlyMicMock).toHaveBeenCalledTimes(2);
    const firstOwner = startEarlyMicMock.mock.calls[0]?.[1];
    const secondOwner = startEarlyMicMock.mock.calls[1]?.[1];
    expect(firstOwner).toBeDefined();
    expect(secondOwner).toBeDefined();
    expect(firstOwner).not.toBe(secondOwner);

    first.unmount();
    second.unmount();
    expect(createLocalMediaOwner).toHaveBeenCalledTimes(2);
  });

  it("ignores stale device swap completions and keeps only the newer resources", async () => {
    const firstAcquisition = deferred<MediaStream>();
    const secondAcquisition = deferred<MediaStream>();
    const acquisitions = [firstAcquisition, secondAcquisition];
    vi.mocked(acquireLocalStream).mockImplementation(() => {
      const next = acquisitions.shift();
      if (!next) throw new Error("unexpected acquisition");
      return next.promise;
    });

    const processors: LocalAudioProcessorHandle[] = [];
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) => {
      const processor = createProcessor(stream);
      processors.push(processor);
      return processor;
    });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(1));

    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));

    const trackA = createTrack("audio", "actual-a");
    const trackB = createTrack("audio", "actual-b");
    await act(async () => {
      secondAcquisition.resolve(createStream([trackB.track]));
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));

    await act(async () => {
      firstAcquisition.resolve(createStream([trackA.track]));
    });
    await waitFor(() =>
      expect(createLocalAudioProcessor).toHaveBeenCalledTimes(1),
    );

    expect(sfu.publishTracks).toHaveBeenCalledTimes(1);
    expect(sfu.replaceTrack).toHaveBeenCalledWith(
      "cam-audio-self",
      trackB.track,
    );
    expect(settingsState.setDevice).toHaveBeenCalledTimes(1);
    expect(settingsState.setDevice).toHaveBeenCalledWith(
      "input",
      "actual-b",
      undefined,
      { label: "audio-actual-b", groupId: "group-actual-b" },
    );
    expect(trackA.stop).toHaveBeenCalled();
    expect(processors[0]?.destroy).not.toHaveBeenCalled();

    hook.unmount();
  });

  it("starts initial media preparation before the SFU joined event", async () => {
    const audio = createTrack("audio", "early-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([audio.track]),
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });

    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    expect(hook.result.current.joined).toBe(false);

    hook.unmount();
  });

  it("starts VAD before the initial publication finishes", async () => {
    const audio = createTrack("audio", "vad-early-audio");
    const acquisition = deferred<MediaStream>();
    vi.mocked(acquireLocalStream).mockReturnValue(acquisition.promise);
    const publication = deferred<void>();

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });

    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    sfu.publishTracks.mockImplementationOnce(() => publication.promise);
    acquisition.resolve(createStream([audio.track]));

    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledOnce());
    publication.resolve();

    hook.unmount();
  });

  it("publishes raw microphone before the outbound processor is ready", async () => {
    const rawTrack = createTrack("audio", "live-raw-audio");
    const publicationTrack = createTrack("audio", "live-processed-audio");
    const rawStream = createStream([rawTrack.track]);
    const publicationStream = createStream([publicationTrack.track]);
    const processorReady = deferred<LocalAudioProcessorHandle>();
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockReturnValue(
      processorReady.promise,
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    expect(createLocalAudioProcessor).toHaveBeenCalledWith(
      rawStream,
      expect.any(Object),
    );
    const initialPublication = sfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(initialPublication?.getAudioTracks()).toEqual([rawTrack.track]);
    expect(sfu.replaceTrack).not.toHaveBeenCalled();

    await act(async () => {
      processorReady.resolve(
        createProcessor(rawStream, publicationStream, rawStream),
      );
    });

    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenCalledWith(
        "cam-audio-self",
        publicationTrack.track,
      ),
    );

    hook.unmount();
  });

  it("keeps the raw microphone when the first outbound processor fails", async () => {
    const rawTrack = createTrack("audio", "raw-fallback-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([rawTrack.track]),
    );
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(null);

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    const initialPublication = sfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(initialPublication?.getAudioTracks()).toEqual([rawTrack.track]);
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    expect(rawTrack.stop).not.toHaveBeenCalled();

    hook.unmount();
  });

  it("commits pending processed audio when initial PartyTracks readiness reconciles it", async () => {
    const rawTrack = createTrack("audio", "pending-raw-audio");
    const preGateTrack = createTrack("audio", "pending-pre-gate-audio");
    const publicationTrack = createTrack("audio", "pending-publication-audio");
    const rawStream = createStream([rawTrack.track]);
    const preGateStream = createStream([preGateTrack.track]);
    const publicationStream = createStream([publicationTrack.track]);
    const processor = createProcessor(
      preGateStream,
      publicationStream,
      preGateStream,
    );
    vi.mocked(processor.destroy).mockImplementation(() => {
      publicationTrack.track.stop();
    });
    const acquisition = deferred<MediaStream>();
    vi.mocked(acquireLocalStream).mockReturnValue(acquisition.promise);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(processor);

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    let partyTracksReady = false;
    const voiceReadyBarrier = deferred<void>();
    const legacyPublish = vi.fn();
    const transportPush = vi.fn();
    const transportSources = new Map<string, MediaStreamTrack>();
    sfu.voiceGW.isReady = false;
    sfu.publishTracks.mockImplementation(async (stream, prefix) => {
      if (!partyTracksReady) await voiceReadyBarrier.promise;
      if (!partyTracksReady) {
        legacyPublish(stream, prefix);
        return;
      }

      for (const track of stream.getTracks()) {
        const trackName = `${prefix}-${track.kind}-self`;
        if (!transportSources.has(trackName)) {
          transportSources.set(trackName, track);
          transportPush(trackName, track);
        }
        if (prefix === "cam") {
          sfu.publishedTracks.set(
            trackName,
            track.clone ? track.clone() : track,
          );
        }
      }
    });

    await act(async () => {
      acquisition.resolve(rawStream);
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    expect(createLocalAudioProcessor).toHaveBeenCalledWith(
      rawStream,
      expect.any(Object),
    );
    expect(transportPush).not.toHaveBeenCalled();

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
      partyTracksReady = true;
      sfu.voiceGW.isReady = true;
      voiceReadyBarrier.resolve();
      sfu.emit("voice-ready", { speaking: {} });
      sfu.emit("voice-reconnected", undefined);
    });

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(settingsState.setDevice).toHaveBeenCalledWith(
        "input",
        "pending-raw-audio",
        undefined,
        {
          label: "audio-pending-raw-audio",
          groupId: "group-pending-raw-audio",
        },
      ),
    );
    expect(transportPush).toHaveBeenCalledOnce();
    expect(transportSources.size).toBe(1);
    expect(transportSources.get("cam-audio-self")).toBe(rawTrack.track);
    expect(sfu.replaceTrack).toHaveBeenCalledWith(
      "cam-audio-self",
      publicationTrack.track,
    );
    expect(legacyPublish).not.toHaveBeenCalled();
    expect(
      sfu.voiceGW.send.mock.calls.some(
        ([message]) =>
          message.op === 1 || message.op === 105 || message.op === 107,
      ),
    ).toBe(false);
    expect(sfu.vad.start).toHaveBeenLastCalledWith(preGateStream);
    expect(processor.destroy).not.toHaveBeenCalled();
    expect(rawTrack.stop).not.toHaveBeenCalled();
    expect(publicationTrack.stop).not.toHaveBeenCalled();

    hook.unmount();
    expect(processor.destroy).toHaveBeenCalledOnce();
    expect(rawTrack.stop).toHaveBeenCalledOnce();
    expect(publicationTrack.stop).toHaveBeenCalledOnce();
  });

  it("stops pre-publication VAD when the initial publication fails", async () => {
    const audio = createTrack("audio", "failed-publish-audio");
    const acquisition = deferred<MediaStream>();
    vi.mocked(acquireLocalStream).mockReturnValue(acquisition.promise);

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });

    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    sfu.publishTracks.mockRejectedValueOnce(
      new Error("initial publish failed"),
    );
    acquisition.resolve(createStream([audio.track]));

    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledOnce());
    await waitFor(() => expect(sfu.vad.stop).toHaveBeenCalled());
    expect(sfu.vad.setGateController).toHaveBeenCalledWith(null);

    hook.unmount();
  });

  it("does not restart initial publication when mute changes while publishing", async () => {
    const audio = createTrack("audio", "initial-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([audio.track]),
    );
    const publicationGate = deferred<void>();

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    const publishImplementation = sfu.publishTracks.getMockImplementation();
    sfu.publishTracks.mockImplementation(async (stream, prefix) => {
      await publishImplementation?.(stream, prefix);
      await publicationGate.promise;
    });

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());

    settingsState.getSettings().isMuted = true;
    await act(async () => {
      hook.rerender();
    });

    expect(acquireLocalStream).toHaveBeenCalledOnce();
    expect(sfu.publishTracks).toHaveBeenCalledOnce();

    await act(async () => {
      publicationGate.resolve();
      await publicationGate.promise;
    });
    await waitFor(() =>
      expect(sfu.setPublishedTrackEnabled).toHaveBeenCalledWith(
        "cam-audio-self",
        false,
      ),
    );
    hook.unmount();
  });

  it("stops a direct camera capture that resolves after teardown", async () => {
    const initialAudio = createTrack("audio", "initial-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([initialAudio.track]),
    );
    const cameraCapture = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => cameraCapture.promise);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    sfu.publishTracks.mockClear();
    sfu.replaceTrack.mockClear();

    const togglePromise = hook.result.current.toggleCamera();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await act(async () => {
      hook.result.current.handleLeave();
    });

    const lateTrack = createTrack("video", "late-camera");
    await act(async () => {
      cameraCapture.resolve(createStream([lateTrack.track]));
      await togglePromise;
    });

    expect(lateTrack.stop).toHaveBeenCalledTimes(1);
    expect(sfu.publishTracks).not.toHaveBeenCalled();
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    expect(createCameraBackgroundEffect).not.toHaveBeenCalled();
    expect(hook.result.current.isCameraActive).toBe(false);

    hook.unmount();
  });

  it("uses pre-gate audio for VAD and publication audio for the SFU", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const preGateTrack = createTrack("audio", "pre-gate-audio");
    const publicationTrack = createTrack("audio", "publication-audio");
    const rawStream = createStream([rawTrack.track]);
    const preGateStream = createStream([preGateTrack.track]);
    const publicationStream = createStream([publicationTrack.track]);
    const processorGate: LocalAudioGateController = {
      resume: vi.fn(),
      setGated: vi.fn(),
    };
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(
      createProcessor(
        preGateStream,
        publicationStream,
        preGateStream,
        processorGate,
      ),
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() =>
      expect(sfu.vad.start).toHaveBeenLastCalledWith(preGateStream),
    );
    const initialAudioPublication = sfu.publishTracks.mock.calls.find(
      ([, prefix]) => prefix === "cam",
    )?.[0] as MediaStream | undefined;
    expect(initialAudioPublication?.getAudioTracks()).toEqual([rawTrack.track]);
    expect(sfu.replaceTrack).toHaveBeenCalledWith(
      "cam-audio-self",
      publicationTrack.track,
    );
    expect(sfu.vad.setGateController).toHaveBeenCalledWith(processorGate);
    expect(createLocalAudioGate).not.toHaveBeenCalled();
    sfu.vad.triggerGate(true);
    sfu.vad.triggerGate(false);
    expect(processorGate.setGated).toHaveBeenLastCalledWith(false);

    sfu.vad.start.mockClear();
    await act(async () => {
      sfu.emit("voice-reconnected", undefined);
    });
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledTimes(1));
    expect(sfu.vad.start).toHaveBeenLastCalledWith(preGateStream);
    const reconnectAudioPublication = sfu.publishTracks.mock.calls.at(
      -1,
    )?.[0] as MediaStream | undefined;
    expect(reconnectAudioPublication?.getAudioTracks()).toEqual([
      publicationTrack.track,
    ]);

    sfu.replaceTrack.mockClear();
    settingsState.getSettings().autoSensitivity = false;
    settingsState.getSettings().sensitivity = -20;
    await act(async () => {
      hook.rerender();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acquireLocalStream).toHaveBeenCalledTimes(1);
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    expect(sfu.vad.setThreshold).toHaveBeenLastCalledWith(10);

    settingsState.getSettings().isMuted = true;
    await act(async () => {
      hook.rerender();
    });
    expect(sfu.vad.stop).toHaveBeenCalled();

    sfu.vad.start.mockClear();
    settingsState.getSettings().isMuted = false;
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledTimes(1));
    expect(sfu.vad.start).toHaveBeenLastCalledWith(preGateStream);

    hook.unmount();
  });

  it("disables sensitivity gating for the Studio profile", async () => {
    const settings = settingsState.getSettings();
    settings.noiseSuppression = false;
    settings.noiseReductionEnabled = false;
    settings.echoCancellation = false;
    settings.autoSensitivity = false;
    settings.streamHighFidelity = true;
    settings.spatialAudioEnabled = false;
    settings.inputProfile = "studio";
    settings.sensitivity = 0;

    const audio = createTrack("audio", "studio-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([audio.track]),
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));

    expect(sfu.vad.disableNoiseGate).toHaveBeenCalled();
    expect(sfu.vad.enableNoiseGate).not.toHaveBeenCalled();
    expect(sfu.vad.setThreshold).toHaveBeenLastCalledWith(3);

    hook.unmount();
  });

  it("keeps the active gate and processor when an audio replacement fails", async () => {
    const initial = createTrack("audio", "initial-audio");
    const replacement = createTrack("audio", "replacement-audio");
    settingsState.getSettings().inputDeviceId = "initial-audio";
    const processors: LocalAudioProcessorHandle[] = [];
    vi.mocked(acquireLocalStream)
      .mockResolvedValueOnce(createStream([initial.track]))
      .mockResolvedValueOnce(createStream([replacement.track]));
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) => {
      const processor = createProcessor(stream);
      processors.push(processor);
      return processor;
    });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(sfu.setPublishedTrackEnabled).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(sfu.vad.setGateController).toHaveBeenCalledTimes(2),
    );

    sfu.replaceTrack.mockResolvedValueOnce(false);
    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(processors).toHaveLength(2));
    await waitFor(() => expect(sfu.replaceTrack).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(processors[1]?.destroy).toHaveBeenCalledOnce());

    expect(processors[0]?.destroy).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("destroys a cancelled replacement gate without disturbing the active gate", async () => {
    const initialAcquisition = deferred<MediaStream>();
    const replacementAcquisition = deferred<MediaStream>();
    const cancelledAcquisition = deferred<MediaStream>();
    const acquisitions = [
      initialAcquisition,
      replacementAcquisition,
      cancelledAcquisition,
    ];
    vi.mocked(acquireLocalStream).mockImplementation(() => {
      const next = acquisitions.shift();
      if (!next) throw new Error("unexpected acquisition");
      return next.promise;
    });
    const processors: LocalAudioProcessorHandle[] = [];
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) => {
      const processor = createProcessor(stream);
      processors.push(processor);
      return processor;
    });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
      initialAcquisition.resolve(
        createStream([createTrack("audio", "initial").track]),
      );
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    const initialSenderTrack = sfu.getPublishedTrack("cam-audio-self");
    expect(initialSenderTrack).toBeTruthy();
    expect(initialSenderTrack).not.toBe(
      processors[0]?.publicationStream.getAudioTracks()[0],
    );

    const replacementResult = deferred<boolean>();
    sfu.replaceTrack.mockImplementationOnce(
      (trackName: string, newTrack: MediaStreamTrack | null) => {
        if (newTrack) {
          sfu.publishedTracks.set(
            trackName,
            newTrack.clone ? newTrack.clone() : newTrack,
          );
        }
        return replacementResult.promise;
      },
    );
    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));
    await act(async () => {
      replacementAcquisition.resolve(
        createStream([createTrack("audio", "replacement").track]),
      );
    });
    await waitFor(() => expect(processors).toHaveLength(2));

    settingsState.getSettings().inputDeviceId = "device-c";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(3));
    await act(async () => {
      replacementResult.resolve(true);
    });
    await waitFor(() => expect(processors[1]?.destroy).toHaveBeenCalledOnce());

    expect(processors[0]?.destroy).not.toHaveBeenCalled();
    expect(sfu.replaceTrack).toHaveBeenCalledTimes(2);
    expect(sfu.replaceTrackIfCurrent).toHaveBeenCalledOnce();
    expect(sfu.replaceTrackIfCurrent.mock.calls[0]?.[2]).toBe(
      processors[0]?.publicationStream.getAudioTracks()[0],
    );
    hook.unmount();
  });

  it("replaces a stalled microphone with a gated identity processor", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const initialPreGateTrack = createTrack("audio", "initial-pre-gate");
    const initialPublicationTrack = createTrack("audio", "initial-publication");
    const recoveryPreGateTrack = createTrack("audio", "recovery-pre-gate");
    const recoveryPublicationTrack = createTrack(
      "audio",
      "recovery-publication",
    );
    const rawStream = createStream([rawTrack.track]);
    const initialPreGateStream = createStream([initialPreGateTrack.track]);
    const initialPublicationStream = createStream([
      initialPublicationTrack.track,
    ]);
    const recoveryPreGateStream = createStream([recoveryPreGateTrack.track]);
    const recoveryPublicationStream = createStream([
      recoveryPublicationTrack.track,
    ]);
    const recoveryGate: LocalAudioGateController = {
      resume: vi.fn(),
      setGated: vi.fn(),
    };
    const processors: LocalAudioProcessorHandle[] = [];
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (_stream) => {
      const processor =
        processors.length === 0
          ? createProcessor(
              initialPreGateStream,
              initialPublicationStream,
              initialPreGateStream,
            )
          : createProcessor(
              recoveryPreGateStream,
              recoveryPublicationStream,
              recoveryPreGateStream,
              recoveryGate,
            );
      processors.push(processor);
      return processor;
    });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));

    rawTrack.track.enabled = false;
    sfu.vad.start.mockClear();
    await act(async () => {
      sfu.emit("outbound-audio-stalled", true);
    });

    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenCalledWith(
        "cam-audio-self",
        recoveryPublicationTrack.track,
      ),
    );
    expect(rawTrack.track.enabled).toBe(true);
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledTimes(1));
    expect(sfu.vad.start.mock.lastCall?.[0].getAudioTracks()).toEqual([
      recoveryPreGateTrack.track,
    ]);
    expect(sfu.vad.setGateController).toHaveBeenLastCalledWith(recoveryGate);
    expect(processors[0]?.destroy).toHaveBeenCalledOnce();

    sfu.publishTracks.mockClear();
    await act(async () => {
      sfu.emit("voice-reconnected", undefined);
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    const reconnectStream = sfu.publishTracks.mock.calls[0]?.[0] as MediaStream;
    expect(reconnectStream.getAudioTracks()).toEqual([
      recoveryPublicationTrack.track,
    ]);

    hook.unmount();
  });

  it("reapplies mute state when raw-track recovery finishes asynchronously", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const rawStream = createStream([rawTrack.track]);
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(
      createProcessor(rawStream),
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));

    const replacement = deferred<boolean>();
    sfu.replaceTrack.mockReturnValueOnce(replacement.promise);
    sfu.setPublishedTrackEnabled.mockClear();
    await act(async () => {
      sfu.emit("outbound-audio-stalled", true);
      settingsState.getSettings().isMuted = true;
      hook.rerender();
      replacement.resolve(true);
    });

    await waitFor(() =>
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        false,
      ),
    );
    hook.unmount();
  });

  it("preserves local speaking state when a voice-ready snapshot omits self", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const rawStream = createStream([rawTrack.track]);
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(
      createProcessor(rawStream),
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledTimes(2));

    await act(async () => {
      sfu.emit("vad-speaking", { participantId: "self", isSpeaking: true });
    });
    await waitFor(() =>
      expect(hook.result.current.speakingUsers.self).toBe(true),
    );

    await act(async () => {
      sfu.emit("voice-ready", { speaking: {} });
    });

    expect(hook.result.current.speakingUsers.self).toBe(true);
    hook.unmount();
  });

  it("never publishes local speaking while the mic is muted", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const rawStream = createStream([rawTrack.track]);
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(
      createProcessor(rawStream),
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await act(async () => {
      sfu.emit("vad-speaking", { participantId: "self", isSpeaking: true });
    });
    await waitFor(() =>
      expect(hook.result.current.speakingUsers.self).toBe(true),
    );

    // A speaking flip does not rebuild the tile list.
    const tilesBefore = hook.result.current.gridItems;
    await act(async () => {
      sfu.emit("vad-speaking", { participantId: "self", isSpeaking: false });
    });
    expect(hook.result.current.speakingUsers.self).toBeUndefined();
    expect(hook.result.current.gridItems).toBe(tilesBefore);
    await act(async () => {
      sfu.emit("vad-speaking", { participantId: "self", isSpeaking: true });
    });
    expect(hook.result.current.gridItems).toBe(tilesBefore);

    // Muting mid-word: the VAD is stopped without a trailing "off".
    chatActions.setSpeakingUsers.mockClear();
    await act(async () => {
      settingsState.getSettings().isMuted = true;
      hook.rerender();
    });
    expect(hook.result.current.speakingUsers.self).toBeUndefined();
    expect(chatActions.setSpeakingUsers).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ self: true }),
      expect.any(String),
    );
    // A late echo while muted stays dark too.
    await act(async () => {
      sfu.emit("speaking", { participantId: "self", speaking: 1 });
    });
    expect(hook.result.current.speakingUsers.self).toBeUndefined();

    await act(async () => {
      settingsState.getSettings().isMuted = false;
      hook.rerender();
    });
    expect(hook.result.current.speakingUsers.self).toBe(true);
    hook.unmount();
  });

  it("clears mapped remote speaking state when disconnect reports speaking off", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const rawStream = createStream([rawTrack.track]);
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(
      createProcessor(rawStream),
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    const remote = {
      id: "remote-uuid",
      clerk_user_id: "user-remote",
      name: "Remote",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
    } as const;
    const replacementRemote = { ...remote, id: "replacement-uuid" };
    await act(async () => {
      sfu.emit("joined", {
        participantId: "self",
        participants: [remote, replacementRemote],
      });
      sfu.emit("speaking", { participantId: remote.id, speaking: 1 });
    });
    expect(hook.result.current.speakingUsers[remote.clerk_user_id]).toBe(true);

    await act(async () => {
      sfu.emit("speaking", {
        participantId: replacementRemote.id,
        speaking: 0,
      });
      sfu.emit("speaking", { participantId: remote.id, speaking: 0 });
    });
    expect(hook.result.current.speakingUsers[remote.clerk_user_id]).toBe(
      undefined,
    );

    hook.unmount();
  });

  it("cancels a pending device swap when direct camera capture starts", async () => {
    const initialAudio = createTrack("audio", "initial-audio");
    const pendingSwap = deferred<MediaStream>();
    let acquisitionCall = 0;
    vi.mocked(acquireLocalStream).mockImplementation(() => {
      acquisitionCall += 1;
      return acquisitionCall === 1
        ? Promise.resolve(createStream([initialAudio.track]))
        : pendingSwap.promise;
    });
    const cameraTrack = createTrack("video", "camera");
    const getUserMedia = vi
      .fn()
      .mockResolvedValue(createStream([cameraTrack.track]));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(1));

    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));
    vi.mocked(cancelPendingLocalStreamAcquisition).mockClear();

    await act(async () => {
      await hook.result.current.toggleCamera();
      expect(cancelPendingLocalStreamAcquisition).toHaveBeenCalledTimes(1);
    });
    expect(hook.result.current.isCameraActive).toBe(true);

    hook.unmount();
  });

  it("orders rapid camera toggles as on then off", async () => {
    const initialAudio = createTrack("audio", "initial-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([initialAudio.track]),
    );
    const cameraCapture = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => cameraCapture.promise);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    sfu.publishTracks.mockClear();
    sfu.replaceTrack.mockClear();
    sfu.unpublishTrack.mockClear();

    const firstToggle = hook.result.current.toggleCamera();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    const secondToggle = hook.result.current.toggleCamera();
    const lateTrack = createTrack("video", "late-camera");
    await act(async () => {
      cameraCapture.resolve(createStream([lateTrack.track]));
      await Promise.all([firstToggle, secondToggle]);
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(lateTrack.stop).toHaveBeenCalledTimes(1);
    expect(sfu.publishTracks).not.toHaveBeenCalled();
    expect(sfu.unpublishTrack).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isCameraActive).toBe(false);

    hook.unmount();
  });

  it("restores the desired camera state after a rejected toggle", async () => {
    const initialAudio = createTrack("audio", "initial-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([initialAudio.track]),
    );
    const retryCapture = deferred<MediaStream>();
    let captureCall = 0;
    const getUserMedia = vi.fn(() => {
      captureCall += 1;
      return captureCall === 1
        ? Promise.reject(new Error("camera capture failed"))
        : retryCapture.promise;
    });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    sfu.publishTracks.mockClear();

    await expect(hook.result.current.toggleCamera()).rejects.toThrow(
      "camera capture failed",
    );
    expect(hook.result.current.isCameraActive).toBe(false);

    const secondToggle = hook.result.current.toggleCamera();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    const retryTrack = createTrack("video", "retry-camera");
    await act(async () => {
      retryCapture.resolve(createStream([retryTrack.track]));
      await secondToggle;
    });

    expect(hook.result.current.isCameraActive).toBe(true);
    expect(sfu.publishTracks).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  it("stops a stale camera effect and direct capture after a newer generation", async () => {
    settingsState.getSettings().cameraBackground = "blur";
    vi.mocked(getCameraBackgroundEffectKey).mockReturnValue("blur");
    const initialAudio = createTrack("audio", "initial-audio");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([initialAudio.track]),
    );
    const cameraCapture = deferred<MediaStream>();
    const getUserMedia = vi.fn(() => cameraCapture.promise);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const effectResult = deferred<CameraBackgroundEffect>();
    vi.mocked(createCameraBackgroundEffect).mockReturnValue(
      effectResult.promise,
    );

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    sfu.publishTracks.mockClear();
    sfu.replaceTrack.mockClear();

    const togglePromise = hook.result.current.toggleCamera();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    const rawTrack = createTrack("video", "stale-camera");
    await act(async () => {
      cameraCapture.resolve(createStream([rawTrack.track]));
    });
    await waitFor(() =>
      expect(createCameraBackgroundEffect).toHaveBeenCalledTimes(1),
    );

    settingsState.getSettings().cameraQuality = "1080p30";
    await act(async () => {
      hook.rerender();
    });

    const effect = createEffect(
      createTrack("video", "stale-effect").track,
      "blur:stale",
    );
    await act(async () => {
      effectResult.resolve(effect);
      await togglePromise;
    });

    expect(rawTrack.stop).toHaveBeenCalledTimes(1);
    expect(effect.stop).toHaveBeenCalledTimes(1);
    expect(sfu.publishTracks).not.toHaveBeenCalled();
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    expect(hook.result.current.isCameraActive).toBe(false);

    hook.unmount();
  });

  it("stops and discards a stale camera background result", async () => {
    const initialAcquisition = deferred<MediaStream>();
    const cameraAcquisitionA = deferred<MediaStream>();
    const cameraAcquisitionB = deferred<MediaStream>();
    const acquisitions = [
      initialAcquisition,
      cameraAcquisitionA,
      cameraAcquisitionB,
    ];
    vi.mocked(acquireLocalStream).mockImplementation(() => {
      const next = acquisitions.shift();
      if (!next) throw new Error("unexpected acquisition");
      return next.promise;
    });
    const processors: LocalAudioProcessorHandle[] = [];
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) => {
      const processor = createProcessor(stream);
      processors.push(processor);
      return processor;
    });

    const rawCamera = createTrack("video", "camera-initial");
    const getUserMedia = vi
      .fn()
      .mockResolvedValue(createStream([rawCamera.track]));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const effectAResult = deferred<CameraBackgroundEffect>();
    const effectBTrack = createTrack("video", "effect-b");
    const effectB = createEffect(effectBTrack.track, "blur:b");
    let backgroundCall = 0;
    vi.mocked(createCameraBackgroundEffect).mockImplementation(() => {
      backgroundCall += 1;
      return backgroundCall === 1
        ? effectAResult.promise
        : Promise.resolve(effectB);
    });

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(1));

    const initialAudio = createTrack("audio", "initial-audio");
    await act(async () => {
      initialAcquisition.resolve(createStream([initialAudio.track]));
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));

    await act(async () => {
      await hook.result.current.toggleCamera();
    });
    await waitFor(() => expect(hook.result.current.isCameraActive).toBe(true));

    vi.mocked(getCameraBackgroundEffectKey).mockReturnValue("blur");
    settingsState.getSettings().cameraBackground = "blur";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));

    const cameraA = createTrack("video", "camera-a");
    const audioA = createTrack("audio", "audio-a");
    await act(async () => {
      cameraAcquisitionA.resolve(createStream([audioA.track, cameraA.track]));
    });
    await waitFor(() =>
      expect(createCameraBackgroundEffect).toHaveBeenCalledTimes(1),
    );

    settingsState.getSettings().cameraQuality = "1080p30";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(3));

    const cameraB = createTrack("video", "camera-b");
    const audioB = createTrack("audio", "audio-b");
    await act(async () => {
      cameraAcquisitionB.resolve(createStream([audioB.track, cameraB.track]));
    });
    await waitFor(() =>
      expect(createCameraBackgroundEffect).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(sfu.replaceTrack).toHaveBeenCalledTimes(4));
    expect(sfu.vad.start.mock.lastCall?.[0].getAudioTracks()).toEqual([
      audioB.track,
    ]);

    const effectA = createEffect(
      createTrack("video", "effect-a").track,
      "blur:a",
    );
    await act(async () => {
      effectAResult.resolve(effectA);
    });
    await waitFor(() => expect(effectA.stop).toHaveBeenCalledTimes(1));

    const replacedTracks = sfu.replaceTrack.mock.calls.map(
      (call) => call[1] as unknown as MediaStreamTrack,
    );
    expect(replacedTracks).toContain(audioB.track);
    expect(replacedTracks).toContain(effectB.track);
    expect(replacedTracks).not.toContain(effectA.track);
    expect(processors[1]?.destroy).toHaveBeenCalledTimes(1);
    expect(processors[2]?.destroy).not.toHaveBeenCalled();
    expect(effectB.stop).not.toHaveBeenCalled();

    hook.unmount();
  });
});
