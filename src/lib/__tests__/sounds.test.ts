import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoundEngine, volumeToGain, type SoundEngineOptions } from "../sounds";
import type { SoundSettings } from "@/stores/useSoundSettingsStore";

vi.mock("../sound-synth", () => ({
  playSynth: vi.fn(),
  renderSynthLoop: vi.fn(() => ({ duration: 2.5 })),
}));

const { playSynth, renderSynthLoop } = await import("../sound-synth");

class FakeParam {
  value = 1;
  setTargetAtTime = vi.fn((v: number) => {
    this.value = v;
  });
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}

class FakeNode {
  connect = vi.fn((n: unknown) => n);
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  detune = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
}

class FakeContext {
  state: AudioContextState = "running";
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  resume = vi.fn(() => Promise.resolve());
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => ({
    duration: new Uint8Array(bytes)[0] / 10,
  }));
}

const enabled: SoundSettings = {
  soundsEnabled: true,
  voiceJoinLeave: true,
  muteDeafen: true,
  notifications: true,
  selfConnectDisconnect: true,
  screenShare: true,
  streamWatcherActivity: true,
  messageReceived: true,
  calls: true,
  soundVolume: 100,
  soundboardVolume: 100,
  voiceJoinSoundboard: {},
  voiceLeaveSoundboard: {},
};

let settings: SoundSettings;
let ctx: FakeContext;
let clock: number;

function makeEngine(overrides: Partial<SoundEngineOptions> = {}) {
  return new SoundEngine({
    resolveUrl: (id, format) => `/sounds/${id}.${format}`,
    getSettings: () => settings,
    createContext: () => ctx as unknown as AudioContext,
    fetch: async () => new Response(new Uint8Array([3])),
    now: () => clock,
    random: () => 0.5,
    canPlayType: () => "probably",
    ...overrides,
  });
}

/** Lets the fetch/decode promises settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  settings = { ...enabled };
  ctx = new FakeContext();
  clock = 1_000;
  vi.mocked(playSynth).mockClear();
  vi.mocked(renderSynthLoop).mockClear();
});

describe("gate", () => {
  it("plays when the master switch and category are on", async () => {
    const engine = makeEngine();
    await engine.preload();
    expect(engine.play("mute")).toBe(true);
    expect(ctx.sources.at(-1)?.start).toHaveBeenCalled();
  });

  it("drops everything when the master switch is off", () => {
    settings.soundsEnabled = false;
    const engine = makeEngine();
    expect(engine.play("callEnd")).toBe(false);
    expect(engine.play("ring")).toBe(false);
    expect(engine.isRinging("ring")).toBe(false);
  });

  it("drops a sound whose category is off and keeps the rest", () => {
    settings.calls = false;
    const engine = makeEngine();
    expect(engine.play("callEnd")).toBe(false);
    expect(engine.play("mute")).toBe(true);
  });

  it("lets settings previews skip toggles but not volume", () => {
    settings.soundsEnabled = false;
    const engine = makeEngine();
    expect(engine.play("notification", { bypassToggles: true })).toBe(true);
    settings.soundVolume = 0;
    clock += 10_000;
    expect(engine.play("notification", { bypassToggles: true })).toBe(false);
  });

  it("reads settings for the given user", () => {
    const getSettings = vi.fn(() => settings);
    const engine = makeEngine({ getSettings });
    engine.play("streamWatcherStart", { userId: "room-guest" });
    expect(getSettings).toHaveBeenCalledWith("room-guest");
  });

  it("applies the volume setting on the master gain", () => {
    settings.soundVolume = 50;
    const engine = makeEngine();
    engine.play("mute");
    const master = ctx.gains[0];
    expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0.25, 0, 0.01);
    settings.soundVolume = 80;
    engine.syncVolume();
    expect(master.gain.value).toBeCloseTo(0.64);
  });

  it("tapers volume perceptually and clamps it", () => {
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(50)).toBe(0.25);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(150)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(1);
  });
});

describe("rate limiting", () => {
  it("coalesces a burst of message knocks", () => {
    const engine = makeEngine();
    expect(engine.play("message")).toBe(true);
    clock += 100;
    expect(engine.play("message")).toBe(false);
    clock += 300;
    expect(engine.play("message")).toBe(true);
  });

  it("shares the limit within a group", () => {
    const engine = makeEngine();
    expect(engine.play("voiceJoin")).toBe(true);
    clock += 50;
    expect(engine.play("voiceLeave")).toBe(false);
  });

  it("steals the oldest voice past the group cap", async () => {
    const engine = makeEngine();
    await engine.preload();
    engine.play("mute");
    const first = ctx.sources.at(-1);
    clock += 100;
    engine.play("unmute");
    expect(first?.stop).toHaveBeenCalled();
  });

  it("varies pitch and level of frequent sounds", async () => {
    const engine = makeEngine({ random: () => 1 });
    await engine.preload();
    engine.play("message");
    const source = ctx.sources.at(-1);
    expect(source?.detune.value).toBe(30);
    expect(ctx.gains.at(-1)?.gain.value).toBeCloseTo(Math.pow(10, 1.5 / 20));
  });
});

describe("rings", () => {
  it("loops the ring buffer on the audio clock and stops it with a fade", async () => {
    const engine = makeEngine();
    await engine.preload();
    expect(engine.play("ring")).toBe(true);
    const source = ctx.sources.at(-1);
    expect(source?.loop).toBe(true);
    expect(source?.loopEnd).toBeCloseTo(0.3);
    ctx.currentTime = 4;
    engine.stop("ring");
    expect(engine.isRinging("ring")).toBe(false);
    expect(source?.stop).toHaveBeenCalledWith(expect.closeTo(4.07, 5));
  });

  it("does not stack a second ring", async () => {
    const engine = makeEngine();
    await engine.preload();
    engine.play("ring");
    const count = ctx.sources.length;
    engine.play("ring");
    expect(ctx.sources.length).toBe(count);
  });

  it("starts the ring once its buffer decodes", async () => {
    const engine = makeEngine();
    expect(engine.play("outgoingRing")).toBe(true);
    expect(ctx.sources.length).toBe(0);
    await flush();
    expect(ctx.sources.at(-1)?.loop).toBe(true);
  });

  it("never starts a ring stopped before its buffer arrived", async () => {
    const engine = makeEngine();
    engine.play("ring");
    engine.stop("ring");
    await flush();
    expect(ctx.sources.length).toBe(0);
  });
});

describe("loading fallback", () => {
  it("uses the synth while buffers are still loading", () => {
    const engine = makeEngine({ fetch: () => new Promise(() => {}) });
    expect(engine.play("notification")).toBe(true);
    expect(playSynth).toHaveBeenCalledWith(
      "notification",
      ctx,
      expect.any(FakeGain),
      0,
    );
  });

  it("falls back to the synth when fetch or decode fails", async () => {
    ctx.decodeAudioData.mockRejectedValue(new Error("bad data"));
    const engine = makeEngine({
      fetch: async () => new Response(null, { status: 404 }),
    });
    await engine.preload();
    expect(() => engine.play("message")).not.toThrow();
    expect(playSynth).toHaveBeenCalled();
    engine.play("ring");
    expect(renderSynthLoop).toHaveBeenCalledWith("ring", ctx);
  });

  it("picks mp3 when the browser can't play WebM Opus", async () => {
    const resolveUrl = vi.fn(() => null);
    const engine = makeEngine({ resolveUrl, canPlayType: () => "" });
    await engine.preload();
    expect(resolveUrl).toHaveBeenCalledWith("message", "mp3");
  });

  it("is silent rather than throwing without Web Audio", () => {
    const engine = makeEngine({
      createContext: () => {
        throw new ReferenceError("AudioContext is not defined");
      },
    });
    expect(engine.play("mute")).toBe(false);
    expect(engine.play("ring")).toBe(false);
    expect(() => engine.stop("ring")).not.toThrow();
  });

  it("asks for a user gesture when the context is suspended", () => {
    ctx.state = "suspended";
    const engine = makeEngine();
    const cb = vi.fn();
    engine.onInteractionNeeded(cb);
    engine.play("mute");
    expect(ctx.resume).toHaveBeenCalled();
    expect(cb).toHaveBeenCalled();
  });
});
