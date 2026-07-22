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
  createLocalAudioProcessor,
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
    readonly vad = {
      setThreshold: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    readonly roomGW = { sendVoiceState: vi.fn(), send: vi.fn() };
    readonly voiceGW = {
      isReady: true,
      send: vi.fn(),
      sendAppEvent: vi.fn(() => true),
    };
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
    readonly publishTracks = vi.fn();
    readonly replaceTrack = vi.fn();
    readonly setPublishedTrackEnabled = vi.fn();
    readonly unpublishTrack = vi.fn();

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

    emit(event: string, value: unknown): void {
      this.handlers.get(event)?.forEach((handler) => handler(value));
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
    voiceChannelStates: {},
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
  createLocalAudioProcessor: vi.fn(),
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
  return { stop, track };
}

function createStream(tracks: MediaStreamTrack[] = []): MediaStream {
  return new TestMediaStream(tracks) as unknown as MediaStream;
}

function createProcessor(
  stream: MediaStream,
  monitorStream = stream,
): LocalAudioProcessorHandle {
  return {
    createMonitorStream: () => monitorStream,
    destroy: vi.fn(),
    mode: "passthrough",
    processedStream: stream,
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
    vi.clearAllMocks();
    vi.mocked(acquireLocalStream).mockReset();
    vi.mocked(cancelPendingLocalStreamAcquisition).mockReset();
    vi.mocked(createCameraBackgroundEffect).mockReset();
    vi.mocked(createLocalAudioProcessor).mockReset();
    vi.mocked(getCameraBackgroundEffectKey).mockReset();
    vi.mocked(getCameraBackgroundEffectKey).mockReturnValue("none");
    sfuInstances.length = 0;
    authUser.current = null;
    settingsState.getSettings().isMuted = false;
    settingsState.getSettings().inputDeviceId = "default";
    settingsState.getSettings().videoDeviceId = "default";
    settingsState.getSettings().cameraQuality = "720p30";
    settingsState.getSettings().cameraBackground = "none";
    vi.stubGlobal("MediaStream", TestMediaStream);
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
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    expect(settingsState.setDevice).toHaveBeenCalledTimes(1);
    expect(settingsState.setDevice).toHaveBeenCalledWith(
      "input",
      "actual-b",
      undefined,
      { label: "audio-actual-b", groupId: "group-actual-b" },
    );
    expect(trackA.stop).not.toHaveBeenCalled();
    expect(processors[0]?.destroy).not.toHaveBeenCalled();

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

  it("uses the published processor monitor for initial and reconnect VAD", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const processedTrack = createTrack("audio", "processed-audio");
    const monitorTrack = createTrack("audio", "monitor-audio");
    const rawStream = createStream([rawTrack.track]);
    const processedStream = createStream([processedTrack.track]);
    const monitorStream = createStream([monitorTrack.track]);
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(
      createProcessor(processedStream, monitorStream),
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
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledTimes(1));
    expect(sfu.vad.start).toHaveBeenLastCalledWith(monitorStream);
    const initialAudioPublication = sfu.publishTracks.mock.calls.find(
      ([, prefix]) => prefix === "cam",
    )?.[0] as MediaStream | undefined;
    expect(initialAudioPublication?.getAudioTracks()).toEqual([
      processedTrack.track,
    ]);

    sfu.vad.start.mockClear();
    await act(async () => {
      sfu.emit("voice-reconnected", undefined);
    });
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledTimes(1));
    expect(sfu.vad.start).toHaveBeenLastCalledWith(monitorStream);
    const reconnectAudioPublication = sfu.publishTracks.mock.calls.at(
      -1,
    )?.[0] as MediaStream | undefined;
    expect(reconnectAudioPublication?.getAudioTracks()).toEqual([
      processedTrack.track,
    ]);

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
    expect(sfu.vad.start).toHaveBeenLastCalledWith(monitorStream);

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
    await waitFor(() => expect(sfu.replaceTrack).toHaveBeenCalledTimes(3));

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
