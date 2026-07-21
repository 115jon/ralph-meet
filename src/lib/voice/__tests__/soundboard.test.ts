import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static instances: FakeAudio[] = [];

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
    this.dispatch("play");
  }

  pause() {
    const wasPaused = this.paused;
    this.paused = true;
    if (!wasPaused) this.dispatch("pause");
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
