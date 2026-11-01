import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIMITER,
  limiterMakeupTrim,
  SoundEngine,
  volumeToGain,
  type SoundEngineOptions,
} from "../sounds";
import type { SoundSettings } from "@/stores/useSoundSettingsStore";

vi.mock("../sound-synth", () => ({
  playSynth: vi.fn(),
  renderSynthLoop: vi.fn(),
}));

const { playSynth } = await import("../sound-synth");

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
  limiter: Record<string, FakeParam> | null = null;
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
    const params = {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    };
    this.limiter = params;
    return Object.assign(new FakeNode(), params);
  }
  /** The first byte of a fake file is its length in tenths of a second. */
  decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => {
    const length = new Uint8Array(bytes)[0];
    if (!length) throw new DOMException("bad data", "EncodingError");
    return { duration: length / 10 };
  });
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
  customSounds: false,
  soundVolume: 100,
  soundboardVolume: 100,
  voiceJoinSoundboard: {},
  voiceLeaveSoundboard: {},
};

const file = (tenths: number) => new Uint8Array([tenths]).buffer;

type RenderLoop = NonNullable<SoundEngineOptions["renderLoop"]>;

let settings: SoundSettings;
let ctx: FakeContext;
let clock: number;
let renderLoop: ReturnType<typeof vi.fn<RenderLoop>>;

function makeEngine(overrides: Partial<SoundEngineOptions> = {}) {
  return new SoundEngine({
    getSettings: () => settings,
    createContext: () => ctx as unknown as AudioContext,
    now: () => clock,
    renderLoop,
    ...overrides,
  });
}

/** Lets decode/render promises settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const voiceGain = expect.any(FakeGain);

beforeEach(() => {
  settings = { ...enabled };
  ctx = new FakeContext();
  clock = 1_000;
  renderLoop = vi.fn<RenderLoop>(
    async (_id, period) => ({ duration: period }) as AudioBuffer,
  );
  vi.mocked(playSynth).mockClear();
});

describe("gate", () => {
  it("plays the built-in sound when the switch and category are on", () => {
    const engine = makeEngine();
    expect(engine.play("mute")).toBe(true);
    expect(playSynth).toHaveBeenCalledWith("mute", ctx, voiceGain, 0);
  });

  it("drops everything when the master switch is off", () => {
    settings.soundsEnabled = false;
    const engine = makeEngine();
    expect(engine.play("callEnd")).toBe(false);
    expect(engine.play("ring")).toBe(false);
    expect(engine.isRinging("ring")).toBe(false);
    expect(playSynth).not.toHaveBeenCalled();
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
});

describe("output chain", () => {
  it("applies the volume setting to both output stages", () => {
    settings.soundVolume = 50;
    const engine = makeEngine();
    engine.play("mute");
    // gains: [0] limiter trim, [1] custom stage, [2] built-in stage.
    for (const stage of [ctx.gains[1], ctx.gains[2]]) {
      expect(stage.gain.setTargetAtTime).toHaveBeenCalledWith(0.25, 0, 0.01);
    }
    settings.soundVolume = 80;
    engine.syncVolume();
    expect(ctx.gains[1].gain.value).toBeCloseTo(0.64);
    expect(ctx.gains[2].gain.value).toBeCloseTo(0.64);
  });

  it("sends built-in sounds straight out and custom files through the limiter", async () => {
    settings.customSounds = true;
    const engine = makeEngine({
      loadCustomSounds: async () => [{ id: "mute", bytes: file(2) }],
    });
    await engine.customSoundsReady();
    engine.play("mute");
    engine.play("deafen");
    const [, limited, master, customVoice, builtinVoice] = ctx.gains;
    expect(master.connect).toHaveBeenCalledWith(ctx.destination);
    expect(customVoice.connect).toHaveBeenCalledWith(limited);
    expect(builtinVoice.connect).toHaveBeenCalledWith(master);
  });

  it("holds a custom file past the limiter warm-up on a fresh context", async () => {
    settings.customSounds = true;
    const engine = makeEngine({
      loadCustomSounds: async () => [{ id: "mute", bytes: file(2) }],
    });
    await engine.customSoundsReady();
    engine.play("mute");
    expect(ctx.sources[0].start).toHaveBeenCalledWith(0.12);
    ctx.currentTime = 5;
    clock += 1_000;
    engine.play("mute");
    expect(ctx.sources[1].start).toHaveBeenCalledWith(5);
  });

  it("keeps 100% volume at unity", () => {
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(50)).toBe(0.25);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(150)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(1);
  });

  it("limits custom files and trims away the compressor's makeup gain", () => {
    makeEngine().play("mute");
    expect(ctx.limiter?.threshold.value).toBe(LIMITER.threshold);
    expect(ctx.limiter?.knee.value).toBe(0);
    expect(ctx.limiter?.ratio.value).toBe(LIMITER.ratio);
    // Full-range gain is -1.9 dB; Web Audio adds back 0.6 of that.
    const trimDb = 20 * Math.log10(limiterMakeupTrim());
    expect(trimDb).toBeCloseTo(-1.14, 6);
    expect(ctx.gains[0].gain.value).toBe(limiterMakeupTrim());
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

  it("fades out the previous voice past the group cap", () => {
    const engine = makeEngine();
    engine.play("mute");
    const first = ctx.gains.at(-1);
    clock += 100;
    engine.play("unmute");
    expect(first?.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.06);
  });

  it("plays every voice at the same level", () => {
    const engine = makeEngine();
    for (let i = 0; i < 3; i++) {
      engine.play("message");
      clock += 1_000;
    }
    const voices = ctx.gains.slice(3).map((g) => g.gain.value);
    expect(voices).toEqual([1, 1, 1]);
  });
});

describe("rings", () => {
  it("loops one rendered cycle of the built-in ring on the audio clock", async () => {
    const engine = makeEngine();
    expect(engine.play("ring")).toBe(true);
    await flush();
    expect(renderLoop).toHaveBeenCalledWith("ring", 2.5, 48000);
    const source = ctx.sources.at(-1);
    expect(source?.loop).toBe(true);
    expect(source?.loopEnd).toBe(2.5);
  });

  it("stops with a short fade", async () => {
    const engine = makeEngine();
    engine.play("outgoingRing");
    await flush();
    const source = ctx.sources.at(-1);
    ctx.currentTime = 4;
    engine.stop("outgoingRing");
    expect(engine.isRinging("outgoingRing")).toBe(false);
    expect(source?.stop).toHaveBeenCalledWith(expect.closeTo(4.07, 5));
  });

  it("does not stack a second ring and renders the cycle once", async () => {
    const engine = makeEngine();
    engine.play("ring");
    engine.play("ring");
    await flush();
    expect(ctx.sources).toHaveLength(1);
    engine.stop("ring");
    engine.play("ring");
    await flush();
    expect(renderLoop).toHaveBeenCalledTimes(1);
  });

  it("never starts a ring stopped before its buffer was ready", async () => {
    const engine = makeEngine();
    engine.play("ring");
    engine.stop("ring");
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });

  it("plays a ring cycle once for previews", () => {
    const engine = makeEngine();
    expect(engine.play("ring", { once: true, bypassToggles: true })).toBe(true);
    expect(engine.isRinging("ring")).toBe(false);
    expect(playSynth).toHaveBeenCalledWith("ring", ctx, voiceGain, 0);
  });

  it("stays silent rather than throwing when the cycle can't render", async () => {
    renderLoop.mockRejectedValue(new Error("no OfflineAudioContext"));
    const engine = makeEngine();
    expect(() => engine.play("ring")).not.toThrow();
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });
});

describe("custom sounds", () => {
  const stored =
    (entries: Array<["message" | "mute" | "ring", ArrayBuffer]>) => async () =>
      entries.map(([id, bytes]) => ({ id, bytes }));

  it("plays an imported file only with the setting on", async () => {
    const engine = makeEngine({
      loadCustomSounds: stored([["message", file(3)]]),
    });
    await engine.customSoundsReady();
    engine.play("message");
    expect(playSynth).toHaveBeenCalledTimes(1);
    expect(ctx.sources).toHaveLength(0);

    settings.customSounds = true;
    clock += 1_000;
    engine.play("message");
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].buffer?.duration).toBe(0.3);
  });

  it("keeps the built-in sound for ids without a file", async () => {
    settings.customSounds = true;
    const engine = makeEngine({
      loadCustomSounds: stored([["message", file(3)]]),
    });
    await engine.customSoundsReady();
    engine.play("mute");
    expect(playSynth).toHaveBeenCalledWith("mute", ctx, voiceGain, 0);
  });

  it("falls back to built-in when a stored file no longer decodes", async () => {
    settings.customSounds = true;
    const engine = makeEngine({
      loadCustomSounds: stored([["message", file(0)]]),
    });
    await engine.customSoundsReady();
    expect(engine.hasCustomSound("message")).toBe(false);
    engine.play("message");
    expect(playSynth).toHaveBeenCalledWith("message", ctx, voiceGain, 0);
  });

  it("survives storage that can't be read", async () => {
    settings.customSounds = true;
    const engine = makeEngine({
      loadCustomSounds: () => Promise.reject(new Error("blocked")),
    });
    await engine.customSoundsReady();
    expect(engine.play("message")).toBe(true);
    expect(playSynth).toHaveBeenCalled();
  });

  it("uses the built-in sound while files are still decoding", () => {
    settings.customSounds = true;
    const engine = makeEngine({
      loadCustomSounds: () => new Promise(() => {}),
    });
    engine.play("notification");
    expect(playSynth).toHaveBeenCalledWith("notification", ctx, voiceGain, 0);
  });

  it("loops a custom ring over the whole file", async () => {
    settings.customSounds = true;
    const engine = makeEngine({
      loadCustomSounds: stored([["ring", file(40)]]),
    });
    engine.play("ring");
    await flush();
    await flush();
    expect(renderLoop).not.toHaveBeenCalled();
    expect(ctx.sources.at(-1)?.loopEnd).toBe(4);
  });

  it("swaps and clears files without a reload", async () => {
    const engine = makeEngine();
    await engine.setCustomSound("mute", file(2));
    expect(engine.hasCustomSound("mute")).toBe(true);
    await engine.setCustomSound("mute", null);
    expect(engine.hasCustomSound("mute")).toBe(false);
    await engine.setCustomSound("unmute", file(2));
    engine.clearCustomSounds();
    expect(engine.hasCustomSound("unmute")).toBe(false);
  });

  it("does not let a slow initial load undo a newer change", async () => {
    let finish: (
      rows: Array<{ id: "mute"; bytes: ArrayBuffer }>,
    ) => void = () => {};
    const engine = makeEngine({
      loadCustomSounds: () => new Promise((r) => (finish = r)),
    });
    void engine.resume();
    await engine.setCustomSound("mute", null);
    finish([{ id: "mute", bytes: file(2) }]);
    await engine.customSoundsReady();
    expect(engine.hasCustomSound("mute")).toBe(false);
  });

  it("plays the custom file for an explicit preview with the setting off", async () => {
    const engine = makeEngine({
      loadCustomSounds: stored([["mute", file(2)]]),
    });
    await engine.customSoundsReady();
    engine.play("mute", { source: "custom", bypassToggles: true });
    expect(ctx.sources).toHaveLength(1);
    expect(playSynth).not.toHaveBeenCalled();
  });
});

describe("without Web Audio", () => {
  it("is silent rather than throwing", async () => {
    const engine = makeEngine({
      createContext: () => {
        throw new ReferenceError("AudioContext is not defined");
      },
    });
    expect(engine.play("mute")).toBe(false);
    expect(engine.play("ring")).toBe(false);
    expect(() => engine.stop("ring")).not.toThrow();
    await expect(engine.decode(file(2))).rejects.toThrow();
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
