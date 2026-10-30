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

  it("attaches default remote audio directly without creating an AudioContext", () => {
    const audioContext = vi.fn();
    vi.stubGlobal("AudioContext", audioContext);
    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });
    const track = { kind: "audio", readyState: "live" } as MediaStreamTrack;

    const stream = pipeline.attachRemoteAudioTrack(
      "participant",
      track,
      "cam-audio-participant",
    );

    expect(stream.getAudioTracks()).toEqual([track]);
    expect(audioContext).not.toHaveBeenCalled();
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(document.querySelector("audio")?.autoplay).toBe(true);
    pipeline.attachRemoteAudioTrack(
      "participant",
      track,
      "cam-audio-participant",
    );
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    pipeline.removeParticipantVolume("participant");
  });

  it("keeps direct volume and output-device controls AudioContext-free", async () => {
    const audioContext = vi.fn();
    vi.stubGlobal("AudioContext", audioContext);
    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });
    pipeline.attachRemoteAudioTrack(
      "participant",
      { kind: "audio", readyState: "live" } as MediaStreamTrack,
      "cam-audio-participant",
    );

    pipeline.setMasterVolume(0.5);
    await pipeline.setOutputDevice("default");
    await pipeline.resumeAudioContext();

    const audioElements = document.querySelectorAll("audio");
    expect(audioElements[audioElements.length - 1]?.volume).toBe(0.5);
    expect(audioContext).not.toHaveBeenCalled();
    pipeline.removeParticipantVolume("participant");
  });

  it("promotes direct audio when effective volume exceeds the element limit", () => {
    const { context } = createAudioContext();
    (context as { state: AudioContextState }).state = "running";
    const audioContext = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("AudioContext", audioContext);
    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });

    pipeline.attachRemoteAudioTrack(
      "participant",
      { kind: "audio", readyState: "live" } as MediaStreamTrack,
      "cam-audio-participant",
    );
    pipeline.setParticipantVolume("participant", 1.5);

    expect(audioContext).toHaveBeenCalledOnce();
    const activators = document.querySelectorAll("audio");
    expect(activators).toHaveLength(1);
    expect(activators[0]?.volume).toBe(0);
    expect(activators[0]?.muted).toBe(false);
    expect(
      (
        pipeline as unknown as {
          directAudioElements: Map<string, Map<string, unknown>>;
        }
      ).directAudioElements.get("participant"),
    ).toBeUndefined();
    pipeline.removeParticipantVolume("participant");
    expect(document.querySelectorAll("audio")).toHaveLength(0);
  });

  it("preserves track-specific volume when promoting to Web Audio", () => {
    const { context } = createAudioContext();
    (context as { state: AudioContextState }).state = "running";
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );
    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });
    const trackName = "cam-audio-participant";

    pipeline.attachRemoteAudioTrack(
      "participant",
      { kind: "audio", readyState: "live" } as MediaStreamTrack,
      trackName,
    );
    pipeline.setTrackVolume("participant", trackName, 0.35);
    pipeline.setTrackPan("participant", trackName, 0.5);

    const gains = (
      pipeline as unknown as {
        volumeGains: Map<string, Map<string, { gain: { value: number } }>>;
      }
    ).volumeGains;
    expect(gains.get("participant")?.get(trackName)?.gain.value).toBe(0.35);
    pipeline.removeParticipantVolume("participant");
  });

  it("keeps the direct sink until a suspended playback context is running", async () => {
    const { context, sources } = createAudioContext();
    let releaseResume: (() => void) | undefined;
    (context.resume as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseResume = () => {
            (context as { state: AudioContextState }).state = "running";
            resolve();
          };
        }),
    );
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );
    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });
    const track = { kind: "audio", readyState: "live" } as MediaStreamTrack;

    pipeline.setMasterVolume(2);
    pipeline.attachRemoteAudioTrack(
      "participant",
      track,
      "cam-audio-participant",
    );

    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(document.querySelector("audio")?.volume).toBe(1);
    expect(sources).toHaveLength(0);

    releaseResume?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(sources).toHaveLength(1);
    expect(
      (
        pipeline as unknown as {
          directAudioElements: Map<string, Map<string, unknown>>;
        }
      ).directAudioElements.get("participant"),
    ).toBeUndefined();
    pipeline.removeParticipantVolume("participant");
  });

  it("adopts a prewarmed interactive context on resume", async () => {
    const { context } = createAudioContext();
    (context as { state: AudioContextState }).state = "running";
    const audioContext = vi.fn(function AudioContextMock(this: unknown) {
      return context;
    });
    vi.stubGlobal("AudioContext", audioContext);

    prewarmAudioContext();
    const pipeline = new AudioPipeline({ onAudioResumed: vi.fn() });
    await pipeline.resumeAudioContext();

    expect(audioContext).toHaveBeenCalledWith({ latencyHint: "interactive" });
    expect(
      (pipeline as unknown as { volumeContext: AudioContext }).volumeContext,
    ).toBe(context);
    pipeline.dispose();
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
