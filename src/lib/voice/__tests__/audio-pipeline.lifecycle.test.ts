// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioPipeline,
  disposePrewarmedAudioContext,
  prewarmAudioContext,
} from "../audio-pipeline";

vi.mock("@/lib/sounds", () => ({
  resumeSoundContext: vi.fn().mockResolvedValue(undefined),
}));

type MockNode = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

class TestMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}

  getTracks() {
    return this.tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

function createAudioContext() {
  const sources: MockNode[] = [];
  const destinations: MockNode[] = [];
  const context = {
    state: "suspended",
    currentTime: 0,
    destination: {},
    onstatechange: null as (() => void) | null,
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => {
      const node = { connect: vi.fn(), disconnect: vi.fn() };
      sources.push(node);
      return node;
    }),
    createMediaStreamDestination: vi.fn(() => {
      const node = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        stream: new TestMediaStream([]),
      };
      destinations.push(node);
      return node;
    }),
    createDynamicsCompressor: vi.fn(() => ({
      attack: {},
      connect: vi.fn(),
      disconnect: vi.fn(),
      knee: {},
      release: {},
      ratio: { value: 0 },
      threshold: { value: 0 },
    })),
    createGain: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        setTargetAtTime: vi.fn(),
        value: 0,
      },
    })),
    createStereoPanner: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      pan: { setTargetAtTime: vi.fn() },
    })),
  } as unknown as AudioContext;

  return { context, destinations, sources };
}

describe("AudioPipeline lifecycle", () => {
  beforeEach(() => {
    disposePrewarmedAudioContext();
    vi.useRealTimers();
    vi.stubGlobal("MediaStream", TestMediaStream);
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  it("disconnects true-stereo nodes when the pipeline is disposed", () => {
    const { context, destinations, sources } = createAudioContext();
    (context as { state: AudioContextState }).state = "running";
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );

    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });
    const track = { kind: "audio", readyState: "live" } as MediaStreamTrack;

    pipeline.createTrueStereoStream(track);
    pipeline.dispose();

    expect(sources[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(destinations[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("removes dead deferred tracks and their processing nodes", () => {
    const { context, sources } = createAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );
    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });
    const track = {
      kind: "audio",
      readyState: "live",
    } as MediaStreamTrack;

    pipeline.applyVolumeToTrack("participant", track, "cam-audio");
    (track as { readyState: MediaStreamTrackState }).readyState = "ended";
    (context as { state: AudioContextState }).state = "running";
    (context.onstatechange as (() => void) | null)?.();

    expect(sources[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(
      (pipeline as unknown as { volumeSources: Map<string, unknown> })
        .volumeSources.size,
    ).toBe(0);
  });

  it("closes an unconsumed prewarmed context after its bounded lifetime", () => {
    vi.useFakeTimers();
    const { context } = createAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );

    prewarmAudioContext();
    vi.advanceTimersByTime(30_000);

    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
