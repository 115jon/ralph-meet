// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { silencePause, silenceResume } = vi.hoisted(() => ({
  silencePause: vi.fn(),
  silenceResume: vi.fn(),
}));
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
    pause: silencePause,
    resume: silenceResume,
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

import { releaseLocalStream, startEarlyMic } from "@/lib/local-media-manager";
import {
  claimVoiceStandby,
  markVoiceChannelJoining,
  holdVoiceStandby,
  retireVoiceStandby,
  resetVoiceStandbyForTests,
  setClaimedVoiceAudible,
  useOccupiedVoiceStandby,
  STANDBY_HIDDEN_GRACE_MS,
  VOICE_STANDBY_STORAGE_KEY,
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

  it("warms with published silence and never opens the microphone", async () => {
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
    expect(instances[0]?.published.get("cam-audio-self")?.id).toBe("silence");
    // Browsing a server must never light the microphone indicator, and the
    // negotiated silence sits paused (no audio thread, no RTP) until a join.
    expect(startEarlyMic).not.toHaveBeenCalled();
    expect(silencePause).toHaveBeenCalledOnce();
    expect(silenceResume).not.toHaveBeenCalled();
    expect(silenceTrack.stop).not.toHaveBeenCalled();

    first.release();
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();
    second.release();
    expect(instances[0]?.disconnect).toHaveBeenCalledWith("component-unmount");
    expect(silenceTrack.stop).toHaveBeenCalled();
  });

  it("claim keeps the session and leaves the silence for the join's capture", async () => {
    const held = holdVoiceStandby(profile);
    await flush();

    const claimed = claimVoiceStandby("channel", "server", true);
    expect(claimed?.sfu).toBe(instances[0]);
    expect(silenceResume).toHaveBeenCalledOnce();
    expect(startEarlyMic).not.toHaveBeenCalled();
    expect(setClaimedVoiceAudible("channel", "server", false)).toBe(true);
    expect(setClaimedVoiceAudible("channel", "server", true)).toBe(true);
    await flush();
    // Silence is not a microphone: mute/unmute leave its sender alone.
    expect(instances[0]?.replaceTrack).not.toHaveBeenCalled();
    expect(instances[0]?.setPublishedTrackEnabled).not.toHaveBeenCalled();
    expect(instances[0]?.published.get("cam-audio-self")?.id).toBe("silence");

    held.release();
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();

    const duringJoin = holdVoiceStandby(profile);
    expect(duringJoin.session).toBeNull();
    expect(instances).toHaveLength(1);
    duringJoin.release();
  });

  it("mutes the microphone the join published without swapping back to silence", async () => {
    const held = holdVoiceStandby(profile);
    await flush();
    claimVoiceStandby("channel", "server", true);
    const sfu = instances[0];
    sfu?.published.set("cam-audio-self", micTrack);

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

  it("retiring a claim releases its media owner and stops the silence", async () => {
    const held = holdVoiceStandby(profile);
    await flush();
    claimVoiceStandby("channel", "server", true);
    retireVoiceStandby("channel", "server");

    expect(releaseLocalStream).toHaveBeenCalled();
    expect(silenceTrack.stop).toHaveBeenCalled();
    expect(setClaimedVoiceAudible("channel", "server", true)).toBe(false);
    held.release();
    expect(instances[0]?.disconnect).not.toHaveBeenCalled();
  });

  it("can be switched off per browser", () => {
    localStorage.setItem(VOICE_STANDBY_STORAGE_KEY, "off");
    try {
      expect(holdVoiceStandby(profile).session).toBeNull();
      expect(instances).toHaveLength(0);
    } finally {
      localStorage.removeItem(VOICE_STANDBY_STORAGE_KEY);
    }
    expect(holdVoiceStandby(profile).session).not.toBeNull();
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

  describe("page activity", () => {
    const member = { clerk_user_id: "other", connected: true };
    const input = {
      serverId: "server",
      joinedChannelId: null as string | null,
      activeChannelId: "a",
      channels: [{ id: "a", server_id: "server", channel_type: "voice" }],
      voiceChannelStates: { a: [member] },
      user: { id: "user-1", username: "ada" },
    };
    let visibility: DocumentVisibilityState = "visible";
    let online = true;

    beforeEach(() => {
      visibility = "visible";
      online = true;
      vi.spyOn(document, "visibilityState", "get").mockImplementation(
        () => visibility,
      );
      vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("drops standby after a hidden tab's grace period and rewarms on return", async () => {
      vi.useFakeTimers();
      try {
        const hook = renderHook(() => useOccupiedVoiceStandby(input));
        await act(async () => flush());
        expect(instances).toHaveLength(1);

        visibility = "hidden";
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        act(() => {
          vi.advanceTimersByTime(STANDBY_HIDDEN_GRACE_MS - 1);
        });
        expect(instances[0]?.disconnect).not.toHaveBeenCalled();
        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(instances[0]?.disconnect).toHaveBeenCalledWith(
          "component-unmount",
        );

        visibility = "visible";
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
          await flush();
        });
        expect(instances).toHaveLength(2);
        hook.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it("drops standby as soon as the browser goes offline", async () => {
      const hook = renderHook(() => useOccupiedVoiceStandby(input));
      await act(async () => flush());
      expect(instances).toHaveLength(1);

      online = false;
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(instances[0]?.disconnect).toHaveBeenCalledWith(
        "component-unmount",
      );
      hook.unmount();
    });
  });
});
