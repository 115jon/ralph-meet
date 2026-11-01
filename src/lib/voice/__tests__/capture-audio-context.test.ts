import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireCaptureAudioContext,
  getLocalAudioDiagnostics,
  isCaptureAudioContextSuspended,
  noteLocalAudioPublication,
  prewarmCaptureAudioContext,
  releaseCaptureAudioContext,
  reportLocalAudioIssue,
  resetCaptureAudioContextForTests,
} from "../capture-audio-context";

function installContext(state: AudioContextState = "suspended") {
  const context = {
    addEventListener: vi.fn(),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    close: vi.fn(function (this: { state: AudioContextState }) {
      this.state = "closed";
      return Promise.resolve();
    }),
    resume: vi.fn(function (this: { state: AudioContextState }) {
      this.state = "running";
      return Promise.resolve();
    }),
    state,
  };
  const AudioContextMock = vi.fn(function () {
    return context;
  });
  vi.stubGlobal("AudioContext", AudioContextMock);
  return { AudioContextMock, context };
}

describe("capture AudioContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCaptureAudioContextForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetCaptureAudioContextForTests();
  });

  it("is created and resumed in the join gesture, then adopted by the processor", () => {
    const { AudioContextMock, context } = installContext();

    prewarmCaptureAudioContext(["/gate.worklet.js"]);
    expect(AudioContextMock).toHaveBeenCalledWith({
      latencyHint: "interactive",
      sampleRate: 48_000,
    });
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.audioWorklet.addModule).toHaveBeenCalledWith(
      "/gate.worklet.js",
    );

    const acquired = acquireCaptureAudioContext();
    expect(acquired).toBe(context);
    expect(AudioContextMock).toHaveBeenCalledOnce();

    // The prewarm hold ends; the processor still holds it.
    vi.advanceTimersByTime(10_000);
    expect(context.close).not.toHaveBeenCalled();
    releaseCaptureAudioContext(context as unknown as AudioContext);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("closes an unused prewarmed context after its hold", () => {
    const { context } = installContext();
    prewarmCaptureAudioContext();
    vi.advanceTimersByTime(9_999);
    expect(context.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("reports a suspended context only while someone uses it", () => {
    const { context } = installContext();
    context.resume.mockImplementation(() => new Promise<void>(() => {}));
    expect(isCaptureAudioContextSuspended()).toBe(false);
    const acquired = acquireCaptureAudioContext();
    expect(isCaptureAudioContextSuspended()).toBe(true);
    releaseCaptureAudioContext(acquired!);
    expect(isCaptureAudioContextSuspended()).toBe(false);
  });

  it("logs each issue once and keeps counts and the publication for diagnostics", () => {
    installContext("running");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportLocalAudioIssue("capture-context-suspended", "suspended");
    reportLocalAudioIssue("capture-context-suspended", "suspended");
    noteLocalAudioPublication("passthrough", { gated: true, lookaheadMs: 20 });

    expect(warn).toHaveBeenCalledOnce();
    expect(getLocalAudioDiagnostics()).toMatchObject({
      publication: "passthrough",
      gated: true,
      gateLookaheadMs: 20,
      issues: { "capture-context-suspended": { count: 2 } },
    });
    warn.mockRestore();
  });
});
