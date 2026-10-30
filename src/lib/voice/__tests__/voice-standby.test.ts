// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { instances, FakeSFU, micTrack, silenceTrack } = vi.hoisted(() => {
  const instances: FakeSFU[] = [];
  const micTrack = {
    id: "mic",
    kind: "audio",
    enabled: true,
    stop: vi.fn(),
  };
  const silenceTrack = {
    id: "silence",
    kind: "audio",
    enabled: true,
    stop: vi.fn(),
  };
  class FakeSFU {
    readonly connect = vi.fn();
    readonly disconnect = vi.fn();
    readonly published = new Map<string, { enabled: boolean; id: string }>();
    readonly publishTracksIf = vi.fn(
      async (
        stream: {
          getAudioTracks: () => Array<{ enabled: boolean; id: string }>;
        },
        _prefix: string,
        stillCurrent: () => boolean,
      ) => {
        if (!stillCurrent()) return false;
        const track = stream.getAudioTracks()[0];
        if (track) this.published.set("cam-audio-self", track);
        return true;
      },
    );
    readonly replaceTrack = vi.fn(
      async (
        trackName: string,
        track: { enabled: boolean; id: string } | null,
      ) => {
        if (track) this.published.set(trackName, track);
        else this.published.delete(trackName);
        return true;
      },
    );
    readonly getPublishedTrack = vi.fn(
      (trackName: string) => this.published.get(trackName) ?? null,
    );
    readonly getMicrophoneTrackName = vi.fn(() => "cam-audio-self");
    senderTrack: { id: string } | null = null;
    readonly senderHasLiveTrack = vi.fn(
      (track: { id: string }) => this.senderTrack === track,
    );
    readonly setPublishedTrackEnabled = vi.fn(
      (trackName: string, enabled: boolean) => {
        const track = this.published.get(trackName);
        if (!track) return false;
        track.enabled = enabled;
        return true;
      },
    );

    constructor() {
      instances.push(this);
    }
  }
  return { instances, FakeSFU, micTrack, silenceTrack };
});

vi.mock("@/lib/sfu-client", () => ({ SFUClient: FakeSFU }));
vi.mock("@/lib/console-logger", () => ({
  clog: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("@/lib/voice/standby-audio", () => ({
  createSilentAudioTrack: () => ({
    track: silenceTrack,
    stream: {
      getAudioTracks: () => [silenceTrack],
      getTracks: () => [silenceTrack],
    },
    stop: vi.fn(() => silenceTrack.stop()),
  }),
}));

vi.mock("@/lib/local-media-manager", () => ({
  createLocalMediaOwner: () => ({}),
  releaseLocalStream: vi.fn(),
  startEarlyMic: vi.fn(async () => ({
    getAudioTracks: () => [micTrack],
    getTracks: () => [micTrack],
  })),
}));
vi.mock("@/stores/useVoiceSettingsStore", () => ({
  useVoiceSettingsStore: {
    getState: () => ({
      getSettings: () => ({
        inputDeviceId: "default",
        inputDeviceLabel: "",
        inputDeviceGroupId: "",
        noiseSuppression: true,
        echoCancellation: true,
        autoSensitivity: true,
        streamHighFidelity: false,
        noiseReductionEnabled: false,
        noiseReductionProvider: "rnnoise",
      }),
    }),
  },
}));

import { startEarlyMic } from "@/lib/local-media-manager";
import {
  claimVoiceStandby,
  markVoiceChannelJoining,
  holdVoiceStandby,
  retireVoiceStandby,
  resetVoiceStandbyForTests,
  setClaimedVoiceAudible,
  useOccupiedVoiceStandby,
} from "@/lib/voice/voice-standby";

const profile = {
  channelId: "channel",
  serverId: "server",
  roomSlug: "voice-server-channel",
  userId: "user-1",
  name: "Ada",
  username: "ada",
  displayName: null,
};

async function flush(): Promise<void> {
  for (let step = 0; step < 8; step += 1) await Promise.resolve();
}

describe("voice standby", () => {
  beforeEach(() => {
    resetVoiceStandbyForTests();
    instances.length = 0;
    micTrack.enabled = true;
    vi.clearAllMocks();
  });

  it("publishes live silence until the microphone is in the sender", async () => {
    const first = holdVoiceStandby(profile);
    const second = holdVoiceStandby(profile);
    await flush();

    expect(instances).toHaveLength(1);
    expect(instances[0]?.connect).toHaveBeenCalledWith(
      "Ada",
      undefined,
      "user-1",
      "ada",
      null,
      undefined,
      expect.objectContaining({ standby: true }),
    );
    const firstStream = instances[0]?.publishTracksIf.mock.calls[0]?.[0] as {
      getAudioTracks: () => Array<{ enabled: boolean; id: string }>;
    };
    expect(firstStream.getAudioTracks()[0]?.id).toBe("silence");
    expect(firstStream.getAudioTracks()[0]?.enabled).toBe(true);
    expect(silenceTrack.stop).not.toHaveBeenCalled();
    expect(instances[0]?.published.get("cam-audio-self")?.id).toBe("silence");
    expect(micTrack.enabled).toBe(false);
    expect(silenceTrack.stop).not.toHaveBeenCalled();

    first.release();
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();
    second.release();
    expect(instances[0]?.disconnect).toHaveBeenCalledWith("component-unmount");
  });

  it("claim turns the warmed microphone on without disconnecting", async () => {
    const held = holdVoiceStandby(profile);
    await flush();

    expect(micTrack.enabled).toBe(false);
    expect(instances[0]?.published.get("cam-audio-self")?.id).toBe("silence");
    const claimed = claimVoiceStandby("channel", "server", false);
    expect(claimed?.track?.id).toBe("mic");
    expect(claimed?.track?.enabled).toBe(false);
    expect(instances[0]?.published.get("cam-audio-self")?.id).toBe("silence");
    expect(setClaimedVoiceAudible("channel", "server", true)).toBe(true);
    await flush();
    expect(micTrack.enabled).toBe(true);
    expect(instances[0]?.published.get("cam-audio-self")?.id).toBe("mic");

    held.release();
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();

    const duringJoin = holdVoiceStandby(profile);
    expect(duringJoin.session).toBeNull();
    expect(instances).toHaveLength(1);
    duringJoin.release();
  });

  it("mutes a live microphone without swapping back to silence", async () => {
    const held = holdVoiceStandby(profile);
    await flush();
    claimVoiceStandby("channel", "server", true);
    await flush();
    const sfu = instances[0];
    expect(sfu?.published.get("cam-audio-self")?.id).toBe("mic");
    sfu?.replaceTrack.mockClear();

    expect(setClaimedVoiceAudible("channel", "server", false)).toBe(true);
    await flush();

    expect(sfu?.replaceTrack).not.toHaveBeenCalled();
    expect(sfu?.published.get("cam-audio-self")?.id).toBe("mic");
    expect(sfu?.setPublishedTrackEnabled).toHaveBeenCalledWith(
      "cam-audio-self",
      false,
    );
    held.release();
  });

  it("keeps the capture when join publishes it before standby notices", async () => {
    const held = holdVoiceStandby(profile);
    const sfu = instances[0];
    if (!sfu) throw new Error("Standby SFU was not created");
    sfu.published.set("cam-audio-self", micTrack);
    const claimed = claimVoiceStandby("channel", "server", true);
    await flush();

    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(claimed?.track).toBe(micTrack);
    expect(claimed?.stream).not.toBeNull();
    held.release();
  });

  it("stops a microphone that arrives after leave", async () => {
    let resolveMic: (stream: MediaStream | null) => void = () => undefined;
    vi.mocked(startEarlyMic).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMic = resolve;
        }),
    );
    const held = holdVoiceStandby(profile);
    await flush();
    const claimed = claimVoiceStandby("channel", "server", true);
    expect(claimed?.stream).toBeNull();
    expect(startEarlyMic).toHaveBeenCalledTimes(1);

    const lateTrack = {
      id: "late-mic",
      enabled: true,
      stop: vi.fn(),
    };
    resolveMic({
      getAudioTracks: () => [lateTrack],
      getTracks: () => [lateTrack],
    } as unknown as MediaStream);
    retireVoiceStandby("channel", "server");
    await flush();

    expect(lateTrack.stop).toHaveBeenCalled();
    held.release();
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();
  });

  it("does not block warming when nothing was claimed", () => {
    expect(claimVoiceStandby("channel", "server", true)).toBeNull();
    const held = holdVoiceStandby(profile);
    expect(held.session).not.toBeNull();
    held.release();
  });

  it("blocks a second warm session while a cold join is in progress", () => {
    markVoiceChannelJoining("channel", "server");
    expect(holdVoiceStandby(profile).session).toBeNull();
    retireVoiceStandby("channel", "server");
    expect(holdVoiceStandby(profile).session).not.toBeNull();
  });

  it("does not drop a warm session when the active channel moves to the front", async () => {
    const member = { clerk_user_id: "other", connected: true };
    const input = {
      serverId: "server",
      joinedChannelId: null as string | null,
      activeChannelId: "b",
      channels: [
        { id: "a", server_id: "server", channel_type: "voice" },
        { id: "b", server_id: "server", channel_type: "voice" },
      ],
      voiceChannelStates: { a: [member], b: [member] },
      user: { id: "user-1", username: "ada" },
    };
    const hook = renderHook(
      (props: typeof input) => useOccupiedVoiceStandby(props),
      { initialProps: input },
    );
    await flush();
    expect(instances).toHaveLength(2);

    hook.rerender({ ...input, activeChannelId: "a" });
    await flush();

    expect(instances).toHaveLength(2);
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();
    expect(instances[1]?.disconnect).not.toHaveBeenCalled();
    hook.unmount();
  });
});
