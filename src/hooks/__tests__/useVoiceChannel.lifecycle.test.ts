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
  resolveLocalAudioPublicationMode,
  type LocalAudioGateController,
  type LocalAudioProcessorHandle,
} from "@/lib/voice/noise-reduction";

const {
  authUser,
  chatState,
  chatActions,
  mediaDevicesState,
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
    isNativeScreenShareActive = false;
    readonly publishNativeScreenShare = vi.fn(async (_options: unknown) => {
      this.isNativeScreenShareActive = true;
    });
    readonly stopNativeScreenShare = vi.fn(async () => {
      this.isNativeScreenShareActive = false;
    });
    readonly updateNativeScreenQuality = vi.fn(async () => false);
    readonly updateSenderEncoding = vi.fn(async () => {});
    readonly stopTracks = vi.fn();
    readonly getParticipantId = vi.fn((): string | null => this.participantId);
    readonly connect = vi.fn();
    readonly resumeAudioContext = vi.fn();
    readonly disconnect = vi.fn();
    readonly waitForVoiceGatewayReady = vi.fn(() => Promise.resolve());
    readonly setParticipantVolume = vi.fn();
    readonly setTrackVolume = vi.fn();
    readonly setTrackPan = vi.fn();
    readonly setRemoteTrackSubscription = vi.fn();
    readonly setUserMapping = vi.fn();
    readonly deleteUserMapping = vi.fn();
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
    outputDeviceLabel: "",
    outputDeviceGroupId: "",
    spatialAudioEnabled: false,
    alwaysShowStreamPreview: false,
    peerSettings: {},
  };

  const settingsState = {
    deviceSelectionRevision: { input: 0, output: 0, video: 0 },
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

  type ListedDevice = {
    deviceId: string;
    groupId: string;
    kind: MediaDeviceKind;
    label: string;
  };
  const mediaDevicesState = {
    audioInputs: [] as ListedDevice[],
    audioOutputs: [] as ListedDevice[],
    videoInputs: [] as ListedDevice[],
  };

  return {
    chatState,
    chatActions,
    authUser,
    mediaDevicesState,
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
const platformState = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/lib/platform", () => ({
  getCapturePolicy: vi.fn(),
  isDesktop: () => platformState.desktop,
  isWgcCaptureAllowed: () => false,
}));
vi.mock("@/lib/host", () => ({
  getHost: () => ({
    media: {
      probeHardwareVideoEncoders: async () => ({ h264: ["nvenc"] }),
      onNativeScreenShareEnded: async () => () => {},
    },
  }),
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
  isNoiseReductionProviderSupported: vi.fn(() => false),
  resolveCaptureAudioProcessing: vi.fn(() => ({
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  })),
  resolveLocalAudioProcessingMode: vi.fn(() => "passthrough"),
  resolveLocalAudioPublicationMode: vi.fn(() => "passthrough"),
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
  useMediaDevices: () => ({
    hasMicrophone: true,
    hasCamera: false,
    ...mediaDevicesState,
  }),
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
import {
  playDisconnect,
  playScreenShareStart,
  playScreenShareStop,
} from "@/lib/sounds";
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

/** The speaking map the hook last published to the chat store. */
function publishedSpeakingUsers(): Record<string, boolean> {
  return (chatActions.setSpeakingUsers.mock.lastCall?.[0] ?? {}) as Record<
    string,
    boolean
  >;
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
    vi.mocked(resolveLocalAudioPublicationMode).mockReset();
    vi.mocked(resolveLocalAudioPublicationMode).mockReturnValue("passthrough");
    vi.mocked(acquireLocalStream).mockReset();
    vi.mocked(cancelPendingLocalStreamAcquisition).mockReset();
    vi.mocked(createCameraBackgroundEffect).mockReset();
    vi.mocked(createLocalAudioProcessor).mockReset();
    vi.mocked(getCameraBackgroundEffectKey).mockReset();
    vi.mocked(getCameraBackgroundEffectKey).mockReturnValue("none");
    sfuInstances.length = 0;
    platformState.desktop = false;
    authUser.current = null;
    chatState.voiceChannelStates = {};
    settingsState.getSettings().isMuted = false;
    settingsState.getSettings().inputDeviceId = "default";
    settingsState.getSettings().inputDeviceLabel = "";
    settingsState.getSettings().inputDeviceGroupId = "";
    settingsState.getSettings().videoDeviceId = "default";
    settingsState.getSettings().cameraQuality = "720p30";
    settingsState.getSettings().cameraBackground = "none";
    settingsState.getSettings().autoSensitivity = true;
    settingsState.getSettings().sensitivity = -50;
    settingsState.getSettings().outputDeviceId = "default";
    settingsState.getSettings().outputDeviceLabel = "";
    settingsState.getSettings().outputDeviceGroupId = "";
    settingsState.deviceSelectionRevision = { input: 0, output: 0, video: 0 };
    mediaDevicesState.audioInputs = [];
    mediaDevicesState.audioOutputs = [];
    mediaDevicesState.videoInputs = [];
    vi.stubGlobal("MediaStream", TestMediaStream);
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) =>
      createProcessor(stream),
    );
  });

  it("merges legacy full updates over cached optional profile fields", () => {
    const cached: VoiceState = {
      id: "remote",
      user_id: "user-remote",
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
      user_id: cached.user_id,
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
      user_id: cached.user_id,
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
          user_id: "other-user",
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
          user_id: "other-user",
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
    await waitFor(() => expect(publishedSpeakingUsers()["user-1"]).toBe(true));

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

  it("stops the VAD monitor clone when leaving while still connecting", async () => {
    const mic = createTrack("audio", "connecting-mic");
    const monitor = createTrack("audio", "connecting-mic-monitor");
    const acquisition = deferred<MediaStream>();
    vi.mocked(acquireLocalStream).mockReturnValue(acquisition.promise);
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) =>
      createProcessor(stream, stream, createStream([monitor.track])),
    );
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    sfu.vad.start.mockReturnValue(true);
    await act(async () => {
      acquisition.resolve(createStream([mic.track]));
    });
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalled());
    expect(sfu.vad.start.mock.lastCall?.[0]?.getAudioTracks()).toEqual([
      monitor.track,
    ]);
    expect(monitor.stop).not.toHaveBeenCalled();
    expect(hook.result.current.joined).toBe(false);

    await act(async () => {
      hook.result.current.handleLeave();
    });

    expect(sfu.disconnect).toHaveBeenCalledWith("user-leave");
    expect(monitor.stop).toHaveBeenCalled();
    hook.unmount();
  });

  it("clears the voice session id after a forced disconnect", async () => {
    authUser.current = { id: "user-1" };
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "forced-mic").track]),
    );
    const onLeft = vi.fn();
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server", onLeft }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(hook.result.current.joined).toBe(true));
    expect(hook.result.current.voiceSessionId).toBe("self");

    await act(async () => {
      window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
    });

    expect(hook.result.current.joined).toBe(false);
    expect(hook.result.current.voiceSessionId).toBeNull();
    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    hook.unmount();
  });

  it.each(["auth-failed", "admission-rejected"] as const)(
    "tears the session down when the call sockets give up (%s)",
    async (event) => {
      authUser.current = { id: "user-1" };
      vi.mocked(acquireLocalStream).mockResolvedValue(
        createStream([createTrack("audio", `${event}-mic`).track]),
      );
      const onLeft = vi.fn();
      const hook = renderHook(() =>
        useVoiceChannel({ channelId: "channel", serverId: "server", onLeft }),
      );
      await act(async () => {
        await hook.result.current.handleJoin();
      });
      const sfu = sfuInstances[0];
      if (!sfu) throw new Error("SFU was not created");
      await act(async () => {
        sfu.emit("joined", { participantId: "self", participants: [] });
      });
      await waitFor(() => expect(hook.result.current.joined).toBe(true));

      await act(async () => {
        sfu.emit(event, undefined);
      });

      expect(hook.result.current.joined).toBe(false);
      expect(hook.result.current.voiceSessionId).toBeNull();
      await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
      await waitFor(() => expect(sfu.disconnect).toHaveBeenCalled());
      hook.unmount();
    },
  );

  it("completes a pending leave when the hook unmounts inside its send window", async () => {
    authUser.current = { id: "user-1" };
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "unmount-window-mic").track]),
    );
    const onLeft = vi.fn();
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server", onLeft }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(hook.result.current.joined).toBe(true));

    act(() => hook.result.current.handleLeave());
    expect(sfu.disconnect).not.toHaveBeenCalled();
    hook.unmount();

    expect(sfu.disconnect).toHaveBeenCalledOnce();
    expect(sfu.disconnect).toHaveBeenCalledWith("user-leave");
    expect(onLeft).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sfu.disconnect).toHaveBeenCalledOnce();
  });

  it("runs one teardown when a forced disconnect lands during a leave", async () => {
    authUser.current = { id: "user-1" };
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "leave-then-force-mic").track]),
    );
    const onLeft = vi.fn();
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server", onLeft }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(hook.result.current.joined).toBe(true));

    await act(async () => {
      hook.result.current.handleLeave();
      hook.result.current.handleLeave();
      window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(sfu.disconnect).toHaveBeenCalledOnce();
    expect(sfu.disconnect).toHaveBeenCalledWith("user-leave");
    expect(playDisconnect).toHaveBeenCalledOnce();
    expect(chatActions.sendVoiceChannelLeave).toHaveBeenCalledOnce();
    expect(onLeft).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("keeps the session on a recoverable SFU error", async () => {
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "error-mic").track]),
    );
    const onLeft = vi.fn();
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server", onLeft }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    await act(async () => {
      sfu.emit("joined", { participantId: "self", participants: [] });
    });
    await waitFor(() => expect(hook.result.current.joined).toBe(true));

    await act(async () => {
      sfu.emit("error", { message: "push failed" });
    });

    expect(hook.result.current.joined).toBe(true);
    expect(onLeft).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("does not report stream audio on while a native share keeps its own audio", async () => {
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "native-mic").track]),
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
    sfu.isNativeScreenShareActive = true;

    await act(async () => {
      await hook.result.current.onToggleStreamAudio();
    });

    // The native branch restarts the pipeline with flipped audio; it never
    // takes the browser-track path that only flips the broadcast flag.
    expect(hook.result.current.isStreamingAudio).toBe(false);
    hook.unmount();
  });

  it("leaves silently when the call sockets give up before the session joined", async () => {
    const onLeft = vi.fn();
    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server", onLeft }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");
    expect(hook.result.current.joined).toBe(false);

    await act(async () => {
      sfu.emit("auth-failed", undefined);
    });

    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    expect(sfu.disconnect).toHaveBeenCalled();
    expect(playDisconnect).not.toHaveBeenCalled();
    expect(playAutomaticSoundboardTrigger).not.toHaveBeenCalledWith(
      "leave",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    hook.unmount();
  });

  async function startNativeShare() {
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "native-share-mic").track]),
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
    await waitFor(() => expect(hook.result.current.joined).toBe(true));
    platformState.desktop = true;
    await act(async () => {
      await hook.result.current.toggleScreenShare({
        sourceId: "window:1",
        sourceName: "Game",
        sourceKind: "window",
        withAudio: true,
      });
    });
    expect(hook.result.current.isScreenSharing).toBe(true);
    expect(hook.result.current.isStreamingAudio).toBe(true);
    expect(sfu.isNativeScreenShareActive).toBe(true);
    return { hook, sfu };
  }

  it("runs one native restart at a time when stream audio is toggled quickly", async () => {
    const { hook, sfu } = await startNativeShare();
    const first = deferred<void>();
    const second = deferred<void>();
    sfu.publishNativeScreenShare
      .mockImplementationOnce(async () => {
        await first.promise;
        sfu.isNativeScreenShareActive = true;
      })
      .mockImplementationOnce(async () => {
        await second.promise;
        sfu.isNativeScreenShareActive = true;
      });

    let toggles: Promise<void>[] = [];
    await act(async () => {
      toggles = [
        hook.result.current.onToggleStreamAudio(),
        hook.result.current.onToggleStreamAudio(),
      ];
    });
    await waitFor(() =>
      expect(sfu.publishNativeScreenShare).toHaveBeenCalledTimes(2),
    );
    // The second toggle waits for the first restart instead of racing it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sfu.publishNativeScreenShare).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve();
    });
    await waitFor(() =>
      expect(sfu.publishNativeScreenShare).toHaveBeenCalledTimes(3),
    );
    await act(async () => {
      second.resolve();
      await Promise.all(toggles);
    });

    expect(
      sfu.publishNativeScreenShare.mock.calls.map(
        ([options]) => (options as { withAudio: boolean }).withAudio,
      ),
    ).toEqual([true, false, true]);
    expect(hook.result.current.isScreenSharing).toBe(true);
    expect(hook.result.current.isStreamingAudio).toBe(true);
    hook.unmount();
  });

  it.each([
    ["the publisher throws", () => Promise.reject(new Error("hook failed"))],
    ["the publisher ends inactive", () => Promise.resolve()],
  ] as const)(
    "clears the share state when a native restart fails (%s)",
    async (_label, publish) => {
      const { hook, sfu } = await startNativeShare();
      sfu.publishNativeScreenShare.mockImplementationOnce(publish);

      await act(async () => {
        await hook.result.current.onToggleStreamAudio();
      });

      expect(sfu.isNativeScreenShareActive).toBe(false);
      expect(hook.result.current.isScreenSharing).toBe(false);
      expect(hook.result.current.currentScreenSource).toBeNull();
      expect(sfu.stopTracks).toHaveBeenCalledWith([
        "screen-video-self",
        "screen-audio-self",
      ]);
      hook.unmount();
    },
  );

  it("ends a native share whose reconnect failed (no CEF fallback allowed)", async () => {
    const { hook, sfu } = await startNativeShare();
    // The transport already stopped the pipeline when its reconnect failed.
    sfu.isNativeScreenShareActive = false;

    await act(async () => {
      sfu.emit("native-screen-share-ended", {
        reason: "connection-failed",
        detail: "reconnect failed: connect timeout",
      });
    });

    await waitFor(() =>
      expect(hook.result.current.isScreenSharing).toBe(false),
    );
    expect(hook.result.current.currentScreenSource).toBeNull();
    expect(sfu.stopTracks).toHaveBeenCalledWith([
      "screen-video-self",
      "screen-audio-self",
    ]);
    hook.unmount();
  });

  async function startBrowserShare() {
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "browser-share-mic").track]),
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
    await waitFor(() => expect(hook.result.current.joined).toBe(true));
    const video = createTrack("video", "screen");
    const audio = createTrack("audio", "screen");
    Object.assign(video.track, { applyConstraints: vi.fn(async () => {}) });
    const getDisplayMedia = vi.fn(async () =>
      createStream([video.track, audio.track]),
    );
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: { getDisplayMedia },
    });
    await act(async () => {
      await hook.result.current.toggleScreenShare();
    });
    return { hook, sfu, video, audio, getDisplayMedia };
  }

  const screenPublishes = (sfu: InstanceType<typeof FakeSFUClient>) =>
    sfu.publishTracks.mock.calls.filter(([, prefix]) => prefix === "screen");

  it("publishes a browser share on the screen prefix and withdraws both names on stop", async () => {
    const { hook, sfu, video, audio } = await startBrowserShare();

    expect(hook.result.current.isScreenSharing).toBe(true);
    expect(hook.result.current.isStreamingAudio).toBe(true);
    expect(screenPublishes(sfu)).toHaveLength(1);
    expect(screenPublishes(sfu)[0]?.[0].getTracks()).toEqual([
      audio.track,
      video.track,
    ]);
    expect(playScreenShareStart).toHaveBeenCalledOnce();

    await act(async () => {
      await hook.result.current.toggleScreenShare();
    });

    expect(sfu.stopTracks).toHaveBeenCalledWith([
      "screen-video-self",
      "screen-audio-self",
    ]);
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
    expect(hook.result.current.isScreenSharing).toBe(false);
    expect(playScreenShareStop).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("ignores a native reconnect failure while the live share is a browser one", async () => {
    const { hook, sfu } = await startBrowserShare();

    await act(async () => {
      sfu.emit("native-screen-share-ended", {
        reason: "connection-failed",
        detail: "reconnect failed: superseded",
      });
    });

    expect(hook.result.current.isScreenSharing).toBe(true);
    expect(sfu.stopTracks).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("toggles a browser share's audio in place without capturing again", async () => {
    const { hook, sfu, getDisplayMedia } = await startBrowserShare();

    await act(async () => {
      await hook.result.current.onToggleStreamAudio();
    });

    expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
      "screen-audio-self",
      false,
    );
    expect(hook.result.current.isStreamingAudio).toBe(false);
    expect(getDisplayMedia).toHaveBeenCalledOnce();
    expect(screenPublishes(sfu)).toHaveLength(1);
    hook.unmount();
  });

  it("ends a browser share quietly when its video ends by itself", async () => {
    const { hook, sfu, video } = await startBrowserShare();

    await act(async () => {
      (video.track.onended as (() => void) | null)?.();
    });

    await waitFor(() =>
      expect(hook.result.current.isScreenSharing).toBe(false),
    );
    expect(sfu.stopTracks).toHaveBeenCalledWith([
      "screen-video-self",
      "screen-audio-self",
    ]);
    expect(playScreenShareStop).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("republishes a browser share after the voice socket reconnects", async () => {
    const { hook, sfu } = await startBrowserShare();

    await act(async () => {
      sfu.emit("voice-reconnected", undefined);
    });

    await waitFor(() => expect(screenPublishes(sfu)).toHaveLength(2));
    hook.unmount();
  });

  it("stops sharing on leave without withdrawing on the wire", async () => {
    const { hook, sfu, video } = await startBrowserShare();

    await act(async () => {
      hook.result.current.handleLeave();
    });

    expect(video.stop).toHaveBeenCalled();
    expect(hook.result.current.isScreenSharing).toBe(false);
    expect(sfu.stopTracks).not.toHaveBeenCalledWith([
      "screen-video-self",
      "screen-audio-self",
    ]);
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
      user_id: "user-remote",
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
          user_id: participant.user_id,
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

    // device-b is a stale id for the device that now opens as actual-b.
    settingsState.getSettings().inputDeviceId = "device-b";
    settingsState.getSettings().inputDeviceGroupId = "group-actual-b";
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
    const publication = sfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(publication?.getAudioTracks()).toEqual([trackB.track]);
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
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

  it("never publishes the raw microphone while the gate is on", async () => {
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

    await waitFor(() =>
      expect(createLocalAudioProcessor).toHaveBeenCalledWith(
        rawStream,
        expect.objectContaining({ voiceGateEnabled: true }),
      ),
    );
    // Nothing goes out until the gate exists.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sfu.publishTracks).not.toHaveBeenCalled();

    const processor = createProcessor(rawStream, publicationStream, rawStream);
    await act(async () => {
      processorReady.resolve(processor);
    });

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    const initialPublication = sfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(initialPublication?.getAudioTracks()).toEqual([
      publicationTrack.track,
    ]);
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    expect(sfu.vad.setGateController).toHaveBeenCalledWith(
      processor.gateController,
    );

    hook.unmount();
  });

  it("builds the gated processor from the early capture, in parallel with the gateway", async () => {
    const rawTrack = createTrack("audio", "early-raw");
    const publicationTrack = createTrack("audio", "early-processed");
    const rawStream = createStream([rawTrack.track]);
    const processor = createProcessor(
      rawStream,
      createStream([publicationTrack.track]),
    );
    vi.mocked(startEarlyMic).mockReturnValueOnce(Promise.resolve(rawStream));
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

    // Built from the early capture before the device sync has its stream.
    await waitFor(() =>
      expect(createLocalAudioProcessor).toHaveBeenCalledWith(
        rawStream,
        expect.objectContaining({ voiceGateEnabled: true }),
      ),
    );
    expect(sfu.publishTracks).not.toHaveBeenCalled();

    // Ready already, so the publication does not wait for a build.
    await act(async () => {
      acquisition.resolve(rawStream);
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    const publication = sfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(publication?.getAudioTracks()).toEqual([publicationTrack.track]);
    expect(createLocalAudioProcessor).toHaveBeenCalledOnce();
    expect(processor.destroy).not.toHaveBeenCalled();

    hook.unmount();
    expect(processor.destroy).toHaveBeenCalledOnce();
  });

  it("discards an early processor built for another capture track", async () => {
    const earlyTrack = createTrack("audio", "early-other");
    const syncedTrack = createTrack("audio", "synced");
    const earlyStream = createStream([earlyTrack.track]);
    const syncedStream = createStream([syncedTrack.track]);
    const processors: LocalAudioProcessorHandle[] = [];
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) => {
      const processor = createProcessor(stream);
      processors.push(processor);
      return processor;
    });
    vi.mocked(startEarlyMic).mockReturnValueOnce(Promise.resolve(earlyStream));
    vi.mocked(acquireLocalStream).mockResolvedValue(syncedStream);

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    expect(processors).toHaveLength(2);
    expect(processors[0]?.destroy).toHaveBeenCalledOnce();
    const publication = sfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(publication?.getAudioTracks()).toEqual([syncedTrack.track]);

    hook.unmount();
  });

  it("reuses the published processor across a voice reconnect", async () => {
    const rawTrack = createTrack("audio", "reconnect-raw");
    const publicationTrack = createTrack("audio", "reconnect-processed");
    const rawStream = createStream([rawTrack.track]);
    const processor = createProcessor(
      rawStream,
      createStream([publicationTrack.track]),
    );
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(processor);

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
      expect(sfu.setPublishedTrackEnabled).toHaveBeenCalled(),
    );

    // The server restarted: a new session republishes what is published.
    await act(async () => {
      sfu.emit("joined", { participantId: "self-2", participants: [] });
      sfu.emit("voice-reconnected", undefined);
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(2));
    const republished = sfu.publishTracks.mock.calls[1]?.[0] as
      | MediaStream
      | undefined;
    expect(republished?.getAudioTracks()).toEqual([publicationTrack.track]);
    // No rebuild: same processor, same worklet node, no new capture.
    expect(createLocalAudioProcessor).toHaveBeenCalledOnce();
    expect(acquireLocalStream).toHaveBeenCalledOnce();
    expect(processor.destroy).not.toHaveBeenCalled();
    expect(sfu.vad.setGateController).toHaveBeenLastCalledWith(
      processor.gateController,
    );

    hook.unmount();
  });

  it("publishes the capture track directly when no processing is on", async () => {
    vi.mocked(resolveLocalAudioPublicationMode).mockReturnValue("direct");
    const rawTrack = createTrack("audio", "direct-audio");
    const rawStream = createStream([rawTrack.track]);
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);

    const hook = renderHook(() =>
      useVoiceChannel({ channelId: "channel", serverId: "server" }),
    );
    await act(async () => {
      await hook.result.current.handleJoin();
    });
    const sfu = sfuInstances[0];
    if (!sfu) throw new Error("SFU was not created");

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    const publication = sfu.publishTracks.mock.calls[0]?.[0] as MediaStream;
    expect(publication.getAudioTracks()).toEqual([rawTrack.track]);
    expect(createLocalAudioProcessor).not.toHaveBeenCalled();
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    // Speaking detection runs on a copy of the published capture track.
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalled());
    const monitor = sfu.vad.start.mock.calls.at(-1)?.[0] as MediaStream;
    expect(monitor.getAudioTracks()[0]?.id).toBe("audio-direct-audio-clone");

    hook.unmount();
  });

  it("switches between direct and processed publication with replaceTrack", async () => {
    const firstTrack = createTrack("audio", "toggle-raw-1");
    const secondTrack = createTrack("audio", "toggle-raw-2");
    const thirdTrack = createTrack("audio", "toggle-raw-3");
    const processedTrack = createTrack("audio", "toggle-processed");
    const streams = [
      createStream([firstTrack.track]),
      createStream([secondTrack.track]),
      createStream([thirdTrack.track]),
    ];
    vi.mocked(acquireLocalStream).mockImplementation(async () => {
      const next = streams.shift();
      if (!next) throw new Error("unexpected acquisition");
      return next;
    });
    const processor = createProcessor(
      streams[1]!,
      createStream([processedTrack.track]),
    );
    vi.mocked(createLocalAudioProcessor).mockResolvedValue(processor);
    vi.mocked(resolveLocalAudioPublicationMode).mockReturnValue("direct");
    const settings = settingsState.getSettings();

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
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    const publication = sfu.publishTracks.mock.calls[0]?.[0] as
      | MediaStream
      | undefined;
    expect(publication?.getAudioTracks()).toEqual([firstTrack.track]);

    // Gate on: the processed track replaces the published one in place.
    vi.mocked(resolveLocalAudioPublicationMode).mockReturnValue("passthrough");
    settings.inputProfile = "standard";
    settings.autoSensitivity = !settings.autoSensitivity;
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenCalledWith(
        "cam-audio-self",
        processedTrack.track,
      ),
    );
    await waitFor(() =>
      expect(sfu.vad.setGateController).toHaveBeenLastCalledWith(
        processor.gateController,
      ),
    );

    // Gate off again: back to the capture track, the processor is released.
    vi.mocked(resolveLocalAudioPublicationMode).mockReturnValue("direct");
    settings.autoSensitivity = !settings.autoSensitivity;
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenLastCalledWith(
        "cam-audio-self",
        thirdTrack.track,
      ),
    );
    await waitFor(() => expect(processor.destroy).toHaveBeenCalledOnce());
    expect(sfu.vad.setGateController).toHaveBeenLastCalledWith(null);
    // One publication; every switch was a track replacement on it.
    expect(
      sfu.publishTracks.mock.calls.filter(([, prefix]) => prefix === "cam"),
    ).toHaveLength(1);
    expect(firstTrack.stop).toHaveBeenCalled();

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
    await waitFor(() => expect(transportPush).toHaveBeenCalledOnce());
    // "System default" is saved as "default", not pinned to the device the
    // OS picked today.
    expect(settingsState.setDevice).not.toHaveBeenCalled();
    expect(transportSources.size).toBe(1);
    // The gated output is what PartyTracks pushes; the raw track never is.
    expect(transportSources.get("cam-audio-self")).toBe(publicationTrack.track);
    expect(sfu.replaceTrack).not.toHaveBeenCalledWith(
      "cam-audio-self",
      rawTrack.track,
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

  it("stops pre-publication VAD when the initial publication keeps failing", async () => {
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
    // One failure is retried (see the next test); every attempt failing
    // spends the reconciler's budget.
    sfu.publishTracks.mockRejectedValue(new Error("initial publish failed"));
    acquisition.resolve(createStream([audio.track]));

    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalledOnce());
    await waitFor(
      () => expect(sfu.vad.setGateController).toHaveBeenCalledWith(null),
      { timeout: 3_000 },
    );
    expect(sfu.publishTracks).toHaveBeenCalledTimes(3);
    expect(sfu.vad.stop).toHaveBeenCalled();

    hook.unmount();
  });

  it("retries a failed initial publication", async () => {
    const audio = createTrack("audio", "retried-publish-audio");
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
    sfu.publishTracks.mockRejectedValueOnce(new Error("transient failure"));
    acquisition.resolve(createStream([audio.track]));

    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(sfu.setPublishedTrackEnabled).toHaveBeenCalledWith(
        "cam-audio-self",
        true,
      ),
    );
    // Not abandoned: the gate stays bound to the published processor.
    expect(sfu.vad.setGateController).not.toHaveBeenCalledWith(null);

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
    // The gated output is published from the first packet: no raw track, no
    // swap afterwards.
    expect(initialAudioPublication?.getAudioTracks()).toEqual([
      publicationTrack.track,
    ]);
    expect(sfu.replaceTrack).not.toHaveBeenCalled();
    expect(sfu.vad.setGateController).toHaveBeenCalledWith(processorGate);
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

  it("keeps the saved microphone when capture falls back to another device", async () => {
    // The saved mic is unplugged, or the list was still hidden: capture
    // opens the system default instead.
    settingsState.getSettings().inputDeviceId = "saved-shure";
    settingsState.getSettings().inputDeviceLabel = "Shure MV7";
    settingsState.getSettings().inputDeviceGroupId = "group-shure";
    const fallback = createTrack("audio", "webcam-mic");
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([fallback.track]),
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

    expect(acquireLocalStream).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "saved-shure",
        deviceLabel: "Shure MV7",
        groupId: "group-shure",
      }),
      null,
      expect.any(String),
      expect.anything(),
    );
    expect(settingsState.setDevice).not.toHaveBeenCalled();

    // An unrelated sync does not reopen the fallback microphone.
    settingsState.getSettings().cameraQuality = "1080p30";
    await act(async () => {
      hook.rerender();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(acquireLocalStream).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  describe("after capture fell back from the saved microphone", () => {
    async function joinOnFallback() {
      settingsState.getSettings().inputDeviceId = "saved-shure";
      settingsState.getSettings().inputDeviceLabel = "Shure MV7";
      settingsState.getSettings().inputDeviceGroupId = "group-shure";
      const fallback = createTrack("audio", "webcam-mic");
      const saved = createTrack("audio", "saved-shure");
      vi.mocked(acquireLocalStream)
        .mockResolvedValueOnce(createStream([fallback.track]))
        .mockResolvedValue(createStream([saved.track]));

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
      expect(acquireLocalStream).toHaveBeenCalledTimes(1);
      return { hook, sfu };
    }

    async function settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }

    it("reopens the saved microphone when it is plugged back in", async () => {
      const { hook } = await joinOnFallback();

      // An unrelated device change leaves the fallback alone.
      mediaDevicesState.audioInputs = [
        {
          deviceId: "webcam-mic",
          groupId: "group-webcam-mic",
          kind: "audioinput",
          label: "audio-webcam-mic",
        },
      ];
      await act(async () => {
        hook.rerender();
      });
      await settle();
      expect(acquireLocalStream).toHaveBeenCalledTimes(1);

      mediaDevicesState.audioInputs = [
        ...mediaDevicesState.audioInputs,
        {
          deviceId: "saved-shure",
          groupId: "group-shure",
          kind: "audioinput",
          label: "Shure MV7",
        },
      ];
      await act(async () => {
        hook.rerender();
      });
      await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));
      expect(acquireLocalStream).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: "saved-shure" }),
        null,
        expect.any(String),
        expect.anything(),
      );

      // Back on the saved device: further syncs keep it.
      settingsState.getSettings().cameraQuality = "1080p30";
      await act(async () => {
        hook.rerender();
      });
      await settle();
      expect(acquireLocalStream).toHaveBeenCalledTimes(2);
      expect(settingsState.setDevice).not.toHaveBeenCalled();
      hook.unmount();
    });

    it("retries the saved microphone when the user picks it again", async () => {
      const { hook } = await joinOnFallback();

      // Picking the saved device writes identical settings; only the
      // selection revision moves.
      settingsState.deviceSelectionRevision = {
        ...settingsState.deviceSelectionRevision,
        input: settingsState.deviceSelectionRevision.input + 1,
      };
      await act(async () => {
        hook.rerender();
      });
      await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));
      expect(acquireLocalStream).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: "saved-shure" }),
        null,
        expect.any(String),
        expect.anything(),
      );
      hook.unmount();
    });
  });

  it("resolves the saved speaker again once the device list unlocks", async () => {
    settingsState.getSettings().outputDeviceId = "old-headphones";
    settingsState.getSettings().outputDeviceLabel = "Headphones";
    settingsState.getSettings().outputDeviceGroupId = "group-old";
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([
        { deviceId: "", groupId: "", kind: "audiooutput", label: "" },
      ]);
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      mediaDevices: { enumerateDevices },
    });
    vi.mocked(acquireLocalStream).mockResolvedValue(
      createStream([createTrack("audio", "mic").track]),
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
    // Hidden list: the saved id is tried as is.
    await waitFor(() =>
      expect(sfu.audio.setOutputDevice).toHaveBeenLastCalledWith(
        "old-headphones",
      ),
    );

    // The first capture unlocks the list; the speaker has a new id.
    const unlocked = [
      {
        deviceId: "default",
        groupId: "group-speakers",
        kind: "audiooutput" as const,
        label: "Default - Speakers",
      },
      {
        deviceId: "new-headphones",
        groupId: "group-new",
        kind: "audiooutput" as const,
        label: "Headphones",
      },
    ];
    enumerateDevices.mockResolvedValue(unlocked);
    mediaDevicesState.audioOutputs = unlocked;
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() =>
      expect(sfu.audio.setOutputDevice).toHaveBeenLastCalledWith(
        "new-headphones",
      ),
    );
    hook.unmount();
    vi.unstubAllGlobals();
    vi.stubGlobal("MediaStream", TestMediaStream);
  });

  it("publishes the new microphone when there is no publication to replace", async () => {
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

    // The media session lost the publication: replacing finds nothing.
    sfu.replaceTrack.mockResolvedValueOnce(false);
    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(2));
    expect(sfu.replaceTrack).toHaveBeenCalledOnce();
    const republished = sfu.publishTracks.mock.calls[1]?.[0] as MediaStream;
    expect(republished.getAudioTracks()).toEqual([replacement.track]);
    await waitFor(() => expect(processors[0]?.destroy).toHaveBeenCalledOnce());
    expect(processors[1]?.destroy).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("keeps the active gate and processor when the replacement cannot be published", async () => {
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

    // No publication to replace, and publishing the new microphone keeps
    // failing: the reconciler spends its retries, then the swap hands the
    // slot back to the active microphone.
    sfu.replaceTrack.mockResolvedValueOnce(false);
    const publish = sfu.publishTracks.getMockImplementation();
    sfu.publishTracks.mockImplementation(async (stream, prefix) => {
      if (stream.getAudioTracks()[0] === replacement.track) {
        throw new Error("publication refused");
      }
      await publish?.(stream, prefix);
    });
    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(processors).toHaveLength(2));
    // The initial publication was gated from the start, so the device swap
    // is the only replacement.
    await waitFor(() => expect(sfu.replaceTrack).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(processors[1]?.destroy).toHaveBeenCalledOnce(), {
      timeout: 3_000,
    });

    expect(processors[0]?.destroy).not.toHaveBeenCalled();
    const lastPublished = sfu.publishTracks.mock.lastCall?.[0] as MediaStream;
    expect(lastPublished.getAudioTracks()).toEqual([initial.track]);
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
    // The abandoned swap hands the microphone back to the active processor
    // through the reconciler (the only writer, so no compare-and-swap).
    expect(sfu.replaceTrack).toHaveBeenCalledTimes(2);
    expect(sfu.replaceTrack).toHaveBeenLastCalledWith(
      "cam-audio-self",
      processors[0]?.publicationStream.getAudioTracks()[0],
    );
    expect(sfu.replaceTrackIfCurrent).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("hands a failed swap back to the committed microphone, not to an abandoned one", async () => {
    const tracks = {
      a: createTrack("audio", "swap-a"),
      b: createTrack("audio", "swap-b"),
      c: createTrack("audio", "swap-c"),
    };
    vi.mocked(acquireLocalStream)
      .mockResolvedValueOnce(createStream([tracks.a.track]))
      .mockResolvedValueOnce(createStream([tracks.b.track]))
      .mockResolvedValueOnce(createStream([tracks.c.track]));
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
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));

    // Swap to B: its replacement hangs.
    const replaceB = deferred<boolean>();
    const replace = sfu.replaceTrack.getMockImplementation();
    sfu.replaceTrack.mockImplementation((trackName, track) => {
      if (track === tracks.b.track) return replaceB.promise;
      if (track === tracks.c.track) {
        return Promise.reject(new Error("transceiver gone"));
      }
      return replace!(trackName, track);
    });
    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenCalledWith(
        "cam-audio-self",
        tracks.b.track,
      ),
    );

    // Swap to C while B is in flight; B lands, then C keeps failing.
    settingsState.getSettings().inputDeviceId = "device-c";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(processors).toHaveLength(3));
    await act(async () => {
      replaceB.resolve(true);
    });

    await waitFor(
      () =>
        expect(sfu.replaceTrack).toHaveBeenLastCalledWith(
          "cam-audio-self",
          tracks.a.track,
        ),
      { timeout: 3_000 },
    );
    await waitFor(() => expect(processors[2]?.destroy).toHaveBeenCalledOnce());
    expect(processors[1]?.destroy).toHaveBeenCalledOnce();
    expect(processors[0]?.destroy).not.toHaveBeenCalled();
    expect(sfu.replaceTrack).not.toHaveBeenLastCalledWith(
      "cam-audio-self",
      tracks.b.track,
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

  it("finishes a stall recovery when the user mutes during it", async () => {
    const rawTrack = createTrack("audio", "raw-audio");
    const rawStream = createStream([rawTrack.track]);
    const recoveryPublicationTrack = createTrack(
      "audio",
      "recovery-publication",
    );
    const recoveryGate: LocalAudioGateController = {
      resume: vi.fn(),
      setGated: vi.fn(),
    };
    const processors: LocalAudioProcessorHandle[] = [];
    vi.mocked(acquireLocalStream).mockResolvedValue(rawStream);
    vi.mocked(createLocalAudioProcessor).mockImplementation(async () => {
      const processor =
        processors.length === 0
          ? createProcessor(
              createStream([createTrack("audio", "pre-gate").track]),
              createStream([createTrack("audio", "publication").track]),
            )
          : createProcessor(
              createStream([createTrack("audio", "recovery-pre-gate").track]),
              createStream([recoveryPublicationTrack.track]),
              undefined,
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

    const replacement = deferred<boolean>();
    sfu.replaceTrack.mockReturnValueOnce(replacement.promise);
    await act(async () => {
      sfu.emit("outbound-audio-stalled", true);
    });
    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenCalledWith(
        "cam-audio-self",
        recoveryPublicationTrack.track,
      ),
    );

    // Mute lands while the replacement is in flight.
    settingsState.getSettings().isMuted = true;
    await act(async () => {
      hook.rerender();
    });
    expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
      "cam-audio-self",
      false,
    );
    await act(async () => {
      replacement.resolve(true);
    });

    // The recovery still commits: its gate is bound and the stalled
    // processor released; the capture was not reopened.
    await waitFor(() =>
      expect(sfu.vad.setGateController).toHaveBeenLastCalledWith(recoveryGate),
    );
    expect(processors[0]?.destroy).toHaveBeenCalledOnce();
    expect(processors[1]?.destroy).not.toHaveBeenCalled();
    expect(acquireLocalStream).toHaveBeenCalledOnce();
    expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
      "cam-audio-self",
      false,
    );
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
    await waitFor(() => expect(sfu.vad.start).toHaveBeenCalled());
    await waitFor(() =>
      expect(sfu.setPublishedTrackEnabled).toHaveBeenCalled(),
    );

    await act(async () => {
      sfu.emit("vad-speaking", { participantId: "self", isSpeaking: true });
    });
    await waitFor(() => expect(publishedSpeakingUsers().self).toBe(true));

    await act(async () => {
      sfu.emit("voice-ready", { speaking: {} });
    });

    expect(publishedSpeakingUsers().self).toBe(true);
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
    await waitFor(() => expect(publishedSpeakingUsers().self).toBe(true));

    // A speaking flip does not rebuild the tile list.
    const tilesBefore = hook.result.current.gridItems;
    await act(async () => {
      sfu.emit("vad-speaking", { participantId: "self", isSpeaking: false });
    });
    expect(publishedSpeakingUsers().self).toBeUndefined();
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
    expect(publishedSpeakingUsers().self).toBeUndefined();
    expect(chatActions.setSpeakingUsers).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ self: true }),
      expect.any(String),
    );
    // A late echo while muted stays dark too.
    await act(async () => {
      sfu.emit("speaking", { participantId: "self", speaking: 1 });
    });
    expect(publishedSpeakingUsers().self).toBeUndefined();

    await act(async () => {
      settingsState.getSettings().isMuted = false;
      hook.rerender();
    });
    expect(publishedSpeakingUsers().self).toBe(true);
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
      user_id: "user-remote",
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
    expect(publishedSpeakingUsers()[remote.user_id]).toBe(true);

    await act(async () => {
      sfu.emit("speaking", {
        participantId: replacementRemote.id,
        speaking: 0,
      });
      sfu.emit("speaking", { participantId: remote.id, speaking: 0 });
    });
    expect(publishedSpeakingUsers()[remote.user_id]).toBe(undefined);

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
    // The camera was never published, so there is nothing to withdraw.
    expect(sfu.unpublishTrack).not.toHaveBeenCalled();
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
    // The initial publication was gated from the start, so there is no
    // raw → processed replacement among these.
    await waitFor(() => expect(sfu.replaceTrack).toHaveBeenCalledTimes(3));
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

  describe("a promoted standby session across a voice reconnect", () => {
    async function joinFromStandby(muted: boolean) {
      authUser.current = { id: "user-1" };
      chatState.voiceChannelStates = {
        channel: [{ user_id: "other-user", name: "Other", connected: true }],
      };
      settingsState.getSettings().isMuted = muted;
      const mic = createTrack("audio", "standby-live-mic");
      vi.mocked(acquireLocalStream).mockResolvedValue(
        createStream([mic.track]),
      );
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
      await act(async () => {
        sfu.emit("joined", { participantId: "self", participants: [] });
      });
      await act(async () => {
        await hook.result.current.handleJoin();
      });
      expect(sfu.roomGW.sendVoiceState).toHaveBeenCalledWith({
        promote_standby: true,
      });
      return { hook, sfu, mic };
    }

    async function setMuted(
      hook: { rerender: () => void },
      muted: boolean,
    ): Promise<void> {
      settingsState.getSettings().isMuted = muted;
      await act(async () => {
        hook.rerender();
      });
    }

    async function reconnect(sfu: InstanceType<typeof FakeSFUClient>) {
      const publishes = sfu.publishTracks.mock.calls.length;
      sfu.setPublishedTrackEnabled.mockClear();
      await act(async () => {
        sfu.emit("voice-reconnected", undefined);
      });
      await waitFor(() =>
        expect(sfu.publishTracks.mock.calls.length).toBeGreaterThan(publishes),
      );
      await waitFor(() =>
        expect(sfu.setPublishedTrackEnabled).toHaveBeenCalled(),
      );
    }

    it("keeps a mute made after joining unmuted", async () => {
      const { hook, sfu, mic } = await joinFromStandby(false);
      // The live microphone replaced the standby silence.
      await waitFor(() =>
        expect(sfu.replaceTrack).toHaveBeenCalledWith(
          "cam-audio-self",
          mic.track,
        ),
      );
      await setMuted(hook, true);
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        false,
      );

      await reconnect(sfu);
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        false,
      );
      expect(sfu.setPublishedTrackEnabled).not.toHaveBeenCalledWith(
        "cam-audio-self",
        true,
      );
      hook.unmount();
    });

    it("keeps an unmute made after joining muted", async () => {
      const { hook, sfu, mic } = await joinFromStandby(true);
      await setMuted(hook, false);
      await waitFor(() =>
        expect(sfu.replaceTrack).toHaveBeenCalledWith(
          "cam-audio-self",
          mic.track,
        ),
      );
      await waitFor(() =>
        expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
          "cam-audio-self",
          true,
        ),
      );

      await reconnect(sfu);
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        true,
      );
      expect(sfu.setPublishedTrackEnabled).not.toHaveBeenCalledWith(
        "cam-audio-self",
        false,
      );
      hook.unmount();
    });

    it("keeps an unmute made after a device swap while muted", async () => {
      const { hook, sfu, mic } = await joinFromStandby(false);
      await waitFor(() =>
        expect(sfu.replaceTrack).toHaveBeenCalledWith(
          "cam-audio-self",
          mic.track,
        ),
      );
      await setMuted(hook, true);
      // A capture while muted publishes the new microphone muted.
      const next = createTrack("audio", "standby-next-mic");
      vi.mocked(acquireLocalStream).mockResolvedValueOnce(
        createStream([next.track]),
      );
      settingsState.getSettings().inputDeviceId = "device-next";
      await act(async () => {
        hook.rerender();
      });
      await waitFor(() =>
        expect(sfu.replaceTrack).toHaveBeenLastCalledWith(
          "cam-audio-self",
          next.track,
        ),
      );
      await waitFor(() =>
        expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
          "cam-audio-self",
          false,
        ),
      );

      await setMuted(hook, false);
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        true,
      );
      await reconnect(sfu);
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        true,
      );
      expect(sfu.setPublishedTrackEnabled).not.toHaveBeenCalledWith(
        "cam-audio-self",
        false,
      );
      hook.unmount();
    });

    it("keeps the mute state when muted twice over a reconnect", async () => {
      const { hook, sfu, mic } = await joinFromStandby(false);
      await waitFor(() =>
        expect(sfu.replaceTrack).toHaveBeenCalledWith(
          "cam-audio-self",
          mic.track,
        ),
      );
      await setMuted(hook, true);
      await reconnect(sfu);
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        false,
      );
      await setMuted(hook, false);
      await reconnect(sfu);
      expect(sfu.setPublishedTrackEnabled).toHaveBeenLastCalledWith(
        "cam-audio-self",
        true,
      );
      hook.unmount();
    });
  });

  it("does not recover a stalled microphone while a device swap is capturing", async () => {
    const tracks = {
      a: createTrack("audio", "stall-a"),
      b: createTrack("audio", "stall-b"),
    };
    const swapCapture = deferred<MediaStream>();
    vi.mocked(acquireLocalStream)
      .mockResolvedValueOnce(createStream([tracks.a.track]))
      .mockReturnValueOnce(swapCapture.promise);
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
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledTimes(1));
    expect(processors).toHaveLength(1);

    // The user picks mic B; its capture is still opening when mic A stalls.
    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));
    await act(async () => {
      sfu.emit("outbound-audio-stalled", true);
    });
    // No recovery processor for mic A.
    expect(processors).toHaveLength(1);

    await act(async () => {
      swapCapture.resolve(createStream([tracks.b.track]));
    });
    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenLastCalledWith(
        "cam-audio-self",
        tracks.b.track,
      ),
    );
    expect(processors).toHaveLength(2);
    expect(processors[1]?.destroy).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("drops a stall recovery that a device swap overtook", async () => {
    const tracks = {
      a: createTrack("audio", "overtaken-a"),
      b: createTrack("audio", "overtaken-b"),
    };
    const swapCapture = deferred<MediaStream>();
    vi.mocked(acquireLocalStream)
      .mockResolvedValueOnce(createStream([tracks.a.track]))
      .mockReturnValueOnce(swapCapture.promise);
    const processors: LocalAudioProcessorHandle[] = [];
    const recoveryHold = deferred<void>();
    const recoveryBuilt = deferred<LocalAudioProcessorHandle>();
    vi.mocked(createLocalAudioProcessor).mockImplementation(async (stream) => {
      const processor = createProcessor(stream);
      processors.push(processor);
      // The recovery's processor (the second build) takes its time.
      if (processors.length === 2) {
        recoveryBuilt.resolve(processor);
        await recoveryHold.promise;
      }
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

    // Mic A stalls; while its recovery builds, the user picks mic B.
    await act(async () => {
      sfu.emit("outbound-audio-stalled", true);
    });
    const recovery = await recoveryBuilt.promise;
    settingsState.getSettings().inputDeviceId = "device-b";
    await act(async () => {
      hook.rerender();
    });
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledTimes(2));
    await act(async () => {
      recoveryHold.resolve();
    });
    await waitFor(() => expect(recovery.destroy).toHaveBeenCalledOnce());
    expect(sfu.replaceTrack).not.toHaveBeenCalled();

    await act(async () => {
      swapCapture.resolve(createStream([tracks.b.track]));
    });
    await waitFor(() =>
      expect(sfu.replaceTrack).toHaveBeenLastCalledWith(
        "cam-audio-self",
        tracks.b.track,
      ),
    );
    hook.unmount();
  });

  it("leaves the first capture alone when the camera is toggled during it", async () => {
    const audio = createTrack("audio", "first-capture");
    const firstCapture = deferred<MediaStream>();
    vi.mocked(acquireLocalStream).mockReturnValueOnce(firstCapture.promise);
    const getUserMedia = vi
      .fn()
      .mockResolvedValue(createStream([createTrack("video", "cam").track]));
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
    await waitFor(() => expect(acquireLocalStream).toHaveBeenCalledOnce());
    vi.mocked(cancelPendingLocalStreamAcquisition).mockClear();

    await act(async () => {
      await hook.result.current.toggleCamera();
    });
    expect(cancelPendingLocalStreamAcquisition).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => {
      firstCapture.resolve(createStream([audio.track]));
    });
    await waitFor(() => expect(sfu.publishTracks).toHaveBeenCalledOnce());
    expect(sfu.unpublishTrack).not.toHaveBeenCalled();
    expect(acquireLocalStream).toHaveBeenCalledOnce();
    hook.unmount();
  });
});
