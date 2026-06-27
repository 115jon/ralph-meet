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
    const handler = typeof listener === "function"
      ? (event?: Event) => listener(event as Event)
      : (event?: Event) => listener.handleEvent(event as Event);
    const listeners = this.listeners.get(type) ?? new Set<(event?: Event) => void>();
    listeners.add(handler);
    this.listeners.set(type, listeners);
  }

  removeEventListener() {
    // Tests here do not depend on listener removal.
  }

  load() {
    // No-op for tests.
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
    const { playSoundboardPlayback, stopSoundboardPlayback } = await import("@/lib/voice/soundboard");
    const { useVoiceSoundboardStore } = await import("@/stores/useVoiceSoundboardStore");

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
    expect(useVoiceSoundboardStore.getState().activePlaybacks["pb-1"]?.paused).toBe(false);

    audio.pause();
    expect(useVoiceSoundboardStore.getState().activePlaybacks["pb-1"]?.paused).toBe(true);

    await audio.play();
    expect(useVoiceSoundboardStore.getState().activePlaybacks["pb-1"]?.paused).toBe(false);

    stopSoundboardPlayback("pb-1");
    expect(useVoiceSoundboardStore.getState().activePlaybacks["pb-1"]).toBeUndefined();
  });
});
