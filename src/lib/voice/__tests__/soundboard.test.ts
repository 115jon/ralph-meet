// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static instances: FakeAudio[] = [];
  static dispatchPlayOnPlay = true;

  src: string;
  paused = true;
  currentTime = 0;
  duration = 30;
  readyState = 4;
  volume = 1;
  preload = "";

  private listeners = new Map<string, Set<(event?: Event) => void>>();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const handler =
      typeof listener === "function"
        ? (event?: Event) => listener(event as Event)
        : (event?: Event) => listener.handleEvent(event as Event);
    const listeners =
      this.listeners.get(type) ?? new Set<(event?: Event) => void>();
    listeners.add(handler);
    this.listeners.set(type, listeners);
  }

  removeEventListener() {
    // Tests here do not depend on listener removal.
  }

  load() {
    // No-op for tests.
  }

  emitError() {
    this.dispatch("error");
  }

  async play() {
    this.paused = false;
    if (FakeAudio.dispatchPlayOnPlay) this.dispatch("play");
  }

  pause() {
    const wasPaused = this.paused;
    this.paused = true;
    if (!wasPaused) this.dispatch("pause");
  }

  emitPlay() {
    this.dispatch("play");
  }

  emitPause() {
    this.dispatch("pause");
  }

  private dispatch(type: string) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) listener();
  }
}

describe("soundboard playback runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeAudio.instances = [];
    FakeAudio.dispatchPlayOnPlay = true;
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("syncs paused state when audio is paused or resumed outside the picker controls", async () => {
    const { playSoundboardPlayback, stopSoundboardPlayback } =
      await import("@/lib/voice/soundboard");
    const { useVoiceSoundboardStore } =
      await import("@/stores/useVoiceSoundboardStore");

    useVoiceSoundboardStore.setState({
      activePlaybacks: {},
      serverMutedByServer: {},
    });

    playSoundboardPlayback({
      playbackId: "pb-1",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Clip",
      dataUrl: "https://example.com/clip.mp3",
      isLocal: true,
    });

    expect(FakeAudio.instances).toHaveLength(1);
    const audio = FakeAudio.instances[0];

    await vi.advanceTimersByTimeAsync(500);
    expect(
      useVoiceSoundboardStore.getState().activePlaybacks["pb-1"]?.paused,
    ).toBe(false);

    audio.pause();
    expect(
      useVoiceSoundboardStore.getState().activePlaybacks["pb-1"]?.paused,
    ).toBe(true);

    await audio.play();
    expect(
      useVoiceSoundboardStore.getState().activePlaybacks["pb-1"]?.paused,
    ).toBe(false);

    stopSoundboardPlayback("pb-1");
    expect(
      useVoiceSoundboardStore.getState().activePlaybacks["pb-1"],
    ).toBeUndefined();
  });

  it("counts only media that has actually started and is audible", async () => {
    const {
      hasActiveSoundboardPlayback,
      playSoundboardPlayback,
      setSoundboardPlaybackVolume,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");

    FakeAudio.dispatchPlayOnPlay = false;
    playSoundboardPlayback({
      playbackId: "activity-1",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Clip",
      mediaUrl: "https://example.com/clip.mp3",
    });

    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(false);

    const audio = FakeAudio.instances[0];
    if (!audio) throw new Error("Missing fake audio");
    audio.emitPlay();
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(true);

    setSoundboardPlaybackVolume("activity-1", 0);
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(false);

    setSoundboardPlaybackVolume("activity-1", 0.5);
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(true);

    audio.pause();
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(false);

    FakeAudio.dispatchPlayOnPlay = true;
    await audio.play();
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(true);

    stopSoundboardPlayback("activity-1");
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(false);
  });

  it("does not report a suspended default tone as active", async () => {
    const resume = vi.fn().mockRejectedValue(new Error("autoplay blocked"));
    const context = {
      close: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: {
          cancelScheduledValues: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          setValueAtTime: vi.fn(),
        },
      })),
      createOscillator: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
        type: "sine",
        onended: null,
      })),
      currentTime: 0,
      destination: {},
      resume,
      state: "suspended",
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );

    const { hasActiveSoundboardPlayback, playSoundboardPlayback } =
      await import("@/lib/voice/soundboard");

    playSoundboardPlayback({
      playbackId: "blocked-tone",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Ping",
      soundId: "ping",
    });

    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(false);
  });

  it("ignores stale media errors after deterministic playback replacement", async () => {
    const {
      hasActiveSoundboardPlayback,
      playSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");
    const staleRenewal = vi.fn(() => true);

    playSoundboardPlayback({
      playbackId: "replacement",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Old",
      mediaUrl: "https://example.com/old.mp3",
      mediaCapabilityExpiresAt: 0,
      renewCapability: staleRenewal,
    });
    const staleAudio = FakeAudio.instances[0];

    playSoundboardPlayback({
      playbackId: "replacement",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "New",
      mediaUrl: "https://example.com/new.mp3",
    });
    staleAudio?.emitError();

    expect(staleRenewal).not.toHaveBeenCalled();
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(true);
    stopSoundboardPlayback("replacement");
  });

  it("keeps identical playback IDs isolated by server scope", async () => {
    const {
      hasActiveSoundboardPlayback,
      playSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");

    playSoundboardPlayback({
      playbackId: "same-id",
      ownerId: "user-1",
      serverKey: "server-a",
      name: "A",
      mediaUrl: "https://example.com/a.mp3",
    });
    playSoundboardPlayback({
      playbackId: "same-id",
      ownerId: "user-1",
      serverKey: "server-b",
      name: "B",
      mediaUrl: "https://example.com/b.mp3",
    });

    expect(hasActiveSoundboardPlayback("user-1", "server-a")).toBe(true);
    expect(hasActiveSoundboardPlayback("user-1", "server-b")).toBe(true);

    stopSoundboardPlayback("same-id", "server-a");
    expect(hasActiveSoundboardPlayback("user-1", "server-a")).toBe(false);
    expect(hasActiveSoundboardPlayback("user-1", "server-b")).toBe(true);

    stopSoundboardPlayback("same-id", "server-b");
  });

  it("keeps overlapping local playbacks active until both are stopped", async () => {
    const { hasActiveSoundboardPlayback, playSoundboardPlayback } =
      await import("@/lib/voice/soundboard");

    playSoundboardPlayback({
      playbackId: "overlap-1",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "First",
      mediaUrl: "https://example.com/first.mp3",
    });
    playSoundboardPlayback({
      playbackId: "overlap-2",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Second",
      mediaUrl: "https://example.com/second.mp3",
    });

    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(true);
    FakeAudio.instances[0]?.pause();
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(true);
    FakeAudio.instances[1]?.pause();
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(false);
  });

  it("filters activity by exact owner and server and excludes local previews", async () => {
    const {
      hasActiveSoundboardPlayback,
      playSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");

    playSoundboardPlayback({
      playbackId: "server-a",
      ownerId: "user-1",
      serverKey: "server-a",
      name: "Server A",
      mediaUrl: "https://example.com/a.mp3",
    });
    playSoundboardPlayback({
      playbackId: "server-b",
      ownerId: "user-1",
      serverKey: "server-b",
      name: "Server B",
      mediaUrl: "https://example.com/b.mp3",
    });
    playSoundboardPlayback({
      playbackId: "preview",
      ownerId: "user-1",
      serverKey: "server-a",
      name: "Preview",
      mediaUrl: "https://example.com/preview.mp3",
      includeInVoiceActivity: false,
    });

    expect(hasActiveSoundboardPlayback("user-1", "server-a")).toBe(true);
    stopSoundboardPlayback("server-a");
    expect(hasActiveSoundboardPlayback("user-1", "server-a")).toBe(false);
    expect(hasActiveSoundboardPlayback("user-1", "server-b")).toBe(true);
    expect(hasActiveSoundboardPlayback("user-2", "server-b")).toBe(false);
  });

  it("does not let stale playback callbacks remove a replacement", async () => {
    const {
      hasActiveSoundboardPlayback,
      playSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");

    playSoundboardPlayback({
      playbackId: "replacement",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Old",
      mediaUrl: "https://example.com/old.mp3",
    });
    const oldAudio = FakeAudio.instances[0];
    playSoundboardPlayback({
      playbackId: "replacement",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "New",
      mediaUrl: "https://example.com/new.mp3",
    });
    const newAudio = FakeAudio.instances[1];

    oldAudio?.emitPause();
    expect(hasActiveSoundboardPlayback("user-1", "server-1")).toBe(true);

    stopSoundboardPlayback("replacement");
    expect(newAudio?.paused).toBe(true);
  });

  it("stops automatic entrance playback when its owner leaves without stopping the exit cue", async () => {
    const {
      playSoundboardPlayback,
      stopAutomaticJoinSoundboardPlaybacksByOwner,
    } = await import("@/lib/voice/soundboard");

    playSoundboardPlayback({
      playbackId: "join-1",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Entrance",
      mediaUrl: "https://example.com/entrance.mp3",
      automaticEvent: "join",
    });
    playSoundboardPlayback({
      playbackId: "leave-1",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Exit",
      mediaUrl: "https://example.com/exit.mp3",
      automaticEvent: "leave",
    });

    stopAutomaticJoinSoundboardPlaybacksByOwner("user-1", "server-1");

    expect(FakeAudio.instances[0]?.paused).toBe(true);
    expect(FakeAudio.instances[1]?.paused).toBe(false);
  });

  it("caps automatic media playback at three seconds", async () => {
    const { playSoundboardPlayback } = await import("@/lib/voice/soundboard");

    playSoundboardPlayback({
      playbackId: "long-auto",
      ownerId: "user-1",
      serverKey: "server-1",
      name: "Long entrance",
      mediaUrl: "https://example.com/long.mp3",
      automaticEvent: "join",
      maxDurationSeconds: 3,
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(FakeAudio.instances[0]?.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeAudio.instances[0]?.paused).toBe(true);
  });

  it("ignores an unknown source-less sound instead of using the first default", async () => {
    const { playSoundboardPlayback } = await import("@/lib/voice/soundboard");

    expect(() =>
      playSoundboardPlayback({
        playbackId: "unknown-sound",
        ownerId: "user-1",
        serverKey: "server-1",
        name: "Unknown",
        soundId: "not-a-default-sound",
      }),
    ).not.toThrow();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("falls back when a server soundboard timestamp is outside the bounded window", async () => {
    const { getSoundboardEventReceivedAt } =
      await import("@/lib/voice/soundboard");
    const now = 1_000_000;

    expect(getSoundboardEventReceivedAt(now - 1_000, now)).toBe(now - 1_000);
    expect(getSoundboardEventReceivedAt(now - 60_000, now)).toBe(now);
    expect(getSoundboardEventReceivedAt(now - 15 * 60 * 1000 - 1, now)).toBe(
      now,
    );
    expect(getSoundboardEventReceivedAt(Infinity, now)).toBe(now);
    expect(getSoundboardEventReceivedAt(now + 100, now)).toBe(now);
    expect(getSoundboardEventReceivedAt(now + 5_001, now)).toBe(now);
  });

  it("does not skip a short clip when the client clock is ahead", async () => {
    const {
      getSoundboardEventReceivedAt,
      playSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");
    const now = 1_000_000;
    vi.setSystemTime(now);
    vi.stubGlobal("HTMLMediaElement", { HAVE_METADATA: 1 });

    playSoundboardPlayback({
      playbackId: "ahead-clock",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Short clip",
      mediaUrl: "/api/soundboard/uploads/short-clip",
      receivedAt: getSoundboardEventReceivedAt(now - 60_000, now),
      isLocal: false,
    });

    expect(FakeAudio.instances[0]?.paused).toBe(false);
    stopSoundboardPlayback("ahead-clock");
  });

  it("renews an expired capability on owner resume instead of replaying stale media", async () => {
    const {
      playSoundboardPlayback,
      resumeSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");
    const renewCapability = vi.fn(() => true);
    vi.setSystemTime(10_000);

    playSoundboardPlayback({
      playbackId: "pb-expired",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Expired clip",
      soundId: "sound-1",
      mediaUrl: "/api/soundboard/uploads/sound-1?cap=expired",
      mediaCapabilityExpiresAt: 5_000,
      renewCapability,
      isLocal: true,
    });

    const staleAudio = FakeAudio.instances[0];
    staleAudio.pause();
    resumeSoundboardPlayback("pb-expired");

    expect(renewCapability).toHaveBeenCalledTimes(1);
    expect(staleAudio.paused).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);

    playSoundboardPlayback({
      playbackId: "pb-expired",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Expired clip",
      soundId: "sound-1",
      mediaUrl: "/api/soundboard/uploads/sound-1?cap=fresh",
      mediaCapabilityExpiresAt: 20_000,
      isLocal: true,
    });

    expect(FakeAudio.instances).toHaveLength(2);
    stopSoundboardPlayback("pb-expired");
  });

  it.each([
    ["behind", 1_000, 5_000],
    ["ahead", 10_000, 5_000],
  ] as const)(
    "renews once after a capability media error with the client clock %s",
    async (_skew, now, expiresAt) => {
      const { playSoundboardPlayback, stopSoundboardPlayback } =
        await import("@/lib/voice/soundboard");
      const renewCapability = vi.fn(() => true);
      vi.setSystemTime(now);

      playSoundboardPlayback({
        playbackId: `media-error-${_skew}`,
        ownerId: "user-1",
        serverKey: "dm-call",
        name: "Expired clip",
        mediaUrl: "/api/soundboard/uploads/sound-1?cap=stale",
        mediaCapabilityExpiresAt: expiresAt,
        renewCapability,
        isLocal: true,
      });

      FakeAudio.instances[0]?.emitError();
      FakeAudio.instances[0]?.emitError();

      expect(renewCapability).toHaveBeenCalledTimes(1);
      stopSoundboardPlayback(`media-error-${_skew}`);
    },
  );

  it("preserves position and paused state across a capability renewal replay", async () => {
    const {
      pauseSoundboardPlayback,
      playSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");
    const renewCapability = vi.fn(() => true);
    vi.setSystemTime(10_000);

    playSoundboardPlayback({
      playbackId: "paused-renewal",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Paused clip",
      mediaUrl: "/api/soundboard/uploads/sound-1?cap=stale",
      mediaCapabilityExpiresAt: 5_000,
      renewCapability,
      isLocal: true,
    });
    const staleAudio = FakeAudio.instances[0];
    staleAudio.currentTime = 12.5;
    pauseSoundboardPlayback("paused-renewal");
    staleAudio.emitError();

    expect(renewCapability).toHaveBeenCalledWith({
      currentTime: 12.5,
      paused: true,
    });

    playSoundboardPlayback({
      playbackId: "paused-renewal",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Paused clip",
      mediaUrl: "/api/soundboard/uploads/sound-1?cap=fresh",
      currentTime: 12.5,
      paused: true,
      isLocal: true,
    });
    const renewedAudio = FakeAudio.instances[1];
    expect(renewedAudio.currentTime).toBe(12.5);
    expect(renewedAudio.paused).toBe(true);
    stopSoundboardPlayback("paused-renewal");
  });

  it("adds bounded delivery latency for unpaused renewal replay recipients", async () => {
    const {
      getSoundboardEventReceivedAt,
      playSoundboardPlayback,
      stopSoundboardPlayback,
    } = await import("@/lib/voice/soundboard");
    const now = 20_000;
    vi.setSystemTime(now);
    vi.stubGlobal("HTMLMediaElement", { HAVE_METADATA: 1 });

    playSoundboardPlayback({
      playbackId: "unpaused-renewal-latency",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Playing clip",
      mediaUrl: "/api/soundboard/uploads/sound-1?cap=fresh",
      currentTime: 12.5,
      paused: false,
      receivedAt: getSoundboardEventReceivedAt(now - 1_250, now),
      isLocal: false,
    });

    expect(FakeAudio.instances[0]?.currentTime).toBeCloseTo(13.75, 5);
    expect(FakeAudio.instances[0]?.paused).toBe(false);
    stopSoundboardPlayback("unpaused-renewal-latency");

    playSoundboardPlayback({
      playbackId: "paused-renewal-latency",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Paused clip",
      mediaUrl: "/api/soundboard/uploads/sound-1?cap=fresh",
      currentTime: 12.5,
      paused: true,
      receivedAt: getSoundboardEventReceivedAt(now - 1_250, now),
      isLocal: false,
    });

    expect(FakeAudio.instances[1]?.currentTime).toBe(12.5);
    expect(FakeAudio.instances[1]?.paused).toBe(true);
    stopSoundboardPlayback("paused-renewal-latency");

    playSoundboardPlayback({
      playbackId: "paused-renewal-no-position",
      ownerId: "user-1",
      serverKey: "dm-call",
      name: "Paused clip without position",
      mediaUrl: "/api/soundboard/uploads/sound-1?cap=fresh",
      paused: true,
      receivedAt: getSoundboardEventReceivedAt(now - 1_250, now),
      isLocal: false,
    });

    expect(FakeAudio.instances[2]?.currentTime).toBe(0);
    expect(FakeAudio.instances[2]?.paused).toBe(true);
    stopSoundboardPlayback("paused-renewal-no-position");
  });
});
