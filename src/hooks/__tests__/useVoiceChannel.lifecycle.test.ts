// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatState, chatActions, settingsState, sfuInstances, FakeSFUClient } =
  vi.hoisted(() => {
    const sfuInstances: FakeSFUClient[] = [];

    class FakeSFUClient {
      readonly handlers = new Map<string, Set<(value: unknown) => void>>();
      readonly audio = { isAudioSuspended: () => false };
      readonly vad = { start: vi.fn(), stop: vi.fn() };
      readonly roomGW = { sendVoiceState: vi.fn(), send: vi.fn() };
      readonly voiceGW = { send: vi.fn() };
      readonly connect = vi.fn();
      readonly resumeAudioContext = vi.fn();
      readonly disconnect = vi.fn();
      readonly setClerkMapping = vi.fn();
      readonly deleteClerkMapping = vi.fn();

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

    const chatActions = {
      sendVoiceChannelJoin: vi.fn(),
      sendVoiceChannelLeave: vi.fn(),
      sendVoiceStateUpdate: vi.fn(),
      setSpeakingUsers: vi.fn(),
    };

    return {
      chatState,
      chatActions,
      settingsState,
      sfuInstances,
      FakeSFUClient,
    };
  });

vi.mock("@/lib/sfu-client", () => ({ SFUClient: FakeSFUClient }));
vi.mock("@kova/react", () => ({ useUser: () => ({ user: null }) }));
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
vi.mock("@/lib/voice-identity", () => ({ resolveVoiceIdentity: vi.fn() }));
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
  playAutomaticSoundboardTrigger: vi.fn().mockResolvedValue(undefined),
  resetAutomaticSoundboardSession: vi.fn(),
  scheduleAutomaticSoundboardCleanup: vi.fn(),
}));
vi.mock("@/lib/useMediaDevices", () => ({
  useMediaDevices: () => ({ hasMicrophone: false, hasCamera: false }),
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

import { useVoiceChannel } from "@/hooks/useVoiceChannel";

class TestMediaStream {
  getTracks() {
    return [];
  }

  getAudioTracks() {
    return [];
  }

  getVideoTracks() {
    return [];
  }
}

describe("useVoiceChannel SFU lifecycle", () => {
  beforeEach(() => {
    sfuInstances.length = 0;
    vi.stubGlobal("MediaStream", TestMediaStream);
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
});
