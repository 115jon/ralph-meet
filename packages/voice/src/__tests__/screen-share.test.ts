import { describe, expect, it, vi } from "vitest";
import {
  PublicationReconciler,
  planPublication,
  type PublicationMedia,
  type PublicationSlot,
  type PublicationValue,
  type ScreenPublication,
} from "../publication";
import {
  ScreenShare,
  screenShareSubscription,
  type ScreenCapture,
  type ScreenShareEvent,
  type ScreenShareRequest,
  type ScreenShareSources,
} from "../screen-share";
import { FakeTimers, flush } from "./fake-timers";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function describeValue(value: PublicationValue<string>): string {
  if (typeof value === "string") return value;
  return value.kind === "native"
    ? "native"
    : `tracks(${value.video},${value.audio ?? "-"})`;
}

/**
 * PartyTracks-like media: withdrawing the screen keeps its video sender
 * alive (keepalive), so it still reads as published afterwards.
 */
class FakeMedia implements PublicationMedia<string> {
  readonly log: string[] = [];
  readonly published = new Map<PublicationSlot, PublicationValue<string>>();
  readonly keptAlive = new Set<PublicationSlot>();
  failures = 0;

  async publish(
    slot: PublicationSlot,
    value: PublicationValue<string>,
  ): Promise<void> {
    this.log.push(`publish:${slot}:${describeValue(value)}`);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("publish failed");
    }
    this.keptAlive.delete(slot);
    this.published.set(slot, value);
  }

  replace(slot: PublicationSlot, value: PublicationValue<string>): boolean {
    this.log.push(`replace:${slot}:${describeValue(value)}`);
    this.published.set(slot, value);
    return true;
  }

  unpublish(slot: PublicationSlot): void {
    this.log.push(`unpublish:${slot}`);
    if (this.published.delete(slot)) this.keptAlive.add(slot);
  }

  setEnabled(slot: PublicationSlot, enabled: boolean): void {
    this.log.push(`enabled:${slot}:${enabled}`);
  }

  isPublished(slot: PublicationSlot): boolean {
    return this.published.has(slot) || this.keptAlive.has(slot);
  }

  /** The screen operations, without set-enabled noise. */
  screenOps(): string[] {
    return this.log.filter(
      (entry) => entry.includes(":screen") && !entry.startsWith("enabled"),
    );
  }
}

interface Capture extends ScreenCapture<string> {
  readonly id: string;
}

type Source = { readonly id: string | null };

function request(
  overrides: Partial<ScreenShareRequest<Source>> = {},
): ScreenShareRequest<Source> {
  const sourceKey = overrides.sourceKey ?? "window:1";
  return {
    source: { id: sourceKey },
    sourceKey,
    quality: "1080p30",
    audio: true,
    preferNative: true,
    ...overrides,
  };
}

/** Steps a fake start takes: succeed, throw, or wait for a deferred. */
type StartStep = "ok" | "throw" | "inactive" | Deferred<void>;

class FakeSources implements ScreenShareSources<Source, Capture> {
  readonly log: string[] = [];
  readonly released: string[] = [];
  readonly ended = new Set<Capture>();
  nativeActive = false;
  nativeEligible = true;
  fallback = false;
  qualityInPlace = true;
  nativeSteps: StartStep[] = [];
  browserSteps: StartStep[] = [];
  browserAudio = true;
  inFlight = 0;
  maxInFlight = 0;
  private count = 0;

  readonly native = {
    eligible: vi.fn((): boolean | Promise<boolean> => this.nativeEligible),
    start: vi.fn(async (req: ScreenShareRequest<Source>): Promise<Capture> => {
      const id = `n${++this.count}`;
      this.log.push(`native-start:${id}:audio=${req.audio}:q=${req.quality}`);
      await this.run(this.nativeSteps.shift() ?? "ok");
      const step = this.lastStep;
      this.nativeActive = step !== "inactive";
      return { id, path: "native", video: null, audio: null };
    }),
    isActive: () => this.nativeActive,
    stop: vi.fn(async () => {
      this.log.push("native-stop");
      this.nativeActive = false;
    }),
    updateQuality: vi.fn(async (quality: string) => {
      this.log.push(`native-quality:${quality}`);
      return this.qualityInPlace;
    }),
    fallbackAllowed: () => this.fallback,
  };

  readonly browser = {
    capture: vi.fn(
      async (req: ScreenShareRequest<Source>): Promise<Capture> => {
        const id = `b${++this.count}`;
        this.log.push(`browser-capture:${id}:audio=${req.audio}`);
        await this.run(this.browserSteps.shift() ?? "ok");
        return {
          id,
          path: "browser",
          video: `${id}-video`,
          audio: req.audio && this.browserAudio ? `${id}-audio` : null,
        };
      },
    ),
    applyQuality: vi.fn((capture: Capture, quality: string) => {
      this.log.push(`apply-quality:${capture.id}:${quality}`);
    }),
  };

  private lastStep: StartStep = "ok";

  private async run(step: StartStep): Promise<void> {
    this.lastStep = step;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (step === "throw") throw new Error("start failed");
      if (step !== "ok" && step !== "inactive") await step.promise;
    } finally {
      this.inFlight -= 1;
    }
  }

  releaseBeforeRestart(req: ScreenShareRequest<Source>): boolean {
    return req.sourceKey !== null;
  }

  isLive(capture: Capture): boolean {
    return !this.ended.has(capture) && !this.released.includes(capture.id);
  }

  release(capture: Capture): void {
    this.log.push(`release:${capture.id}`);
    this.released.push(capture.id);
  }
}

function setup(options: { native?: boolean } = {}) {
  const timers = new FakeTimers();
  const media = new FakeMedia();
  const publication = new PublicationReconciler<string>({ media, timers });
  const sources = new FakeSources();
  const errors: string[] = [];
  const share = new ScreenShare<string, Source, Capture>({
    publication,
    sources:
      options.native === false
        ? Object.assign(sources, { native: null })
        : sources,
    onError: (step) => errors.push(step),
  });
  const events: ScreenShareEvent<Source, Capture>[] = [];
  const phases: string[] = [share.phase];
  share.subscribe((event) => {
    events.push(event);
    if (event.type === "phase") phases.push(event.phase);
  });
  const named = (type: string) => events.filter((e) => e.type === type);
  return {
    timers,
    media,
    publication,
    sources,
    share,
    events,
    phases,
    named,
    errors,
  };
}

/** Starts a share and waits for it to be live. */
async function live(
  ctx: ReturnType<typeof setup>,
  req: ScreenShareRequest<Source> = request(),
) {
  ctx.share.start(req);
  await ctx.share.idle();
  expect(ctx.share.phase).toBe("live");
}

describe("ScreenShare: browser path", () => {
  it("goes off → starting → live and publishes the capture on the screen slot", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: null }));

    expect(ctx.phases).toEqual(["off", "starting", "live"]);
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
    ]);
    expect(ctx.media.log).toContain("enabled:screen:true");
    expect(ctx.sources.log).toEqual([
      "browser-capture:b1:audio=true",
      "apply-quality:b1:1080p30",
    ]);
    expect(ctx.named("started")).toMatchObject([{ restarted: false }]);
    expect(ctx.share.live?.request.audio).toBe(true);
    expect(ctx.share.live?.path).toBe("browser");
  });

  it("goes live → stopping → off: unpublishes, then releases", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    ctx.share.stop();
    expect(ctx.share.phase).toBe("stopping");
    await ctx.share.idle();

    expect(ctx.phases).toEqual(["off", "starting", "live", "stopping", "off"]);
    expect(ctx.media.screenOps().at(-1)).toBe("unpublish:screen");
    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.named("ended")).toEqual([
      { type: "ended", reason: "stopped", announced: true },
    ]);
    expect(ctx.share.live).toBeNull();
    expect(ctx.share.wanted).toBeNull();
  });

  it("reports the audio the capture carries, not the audio asked for", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    ctx.sources.browserAudio = false;
    await live(ctx);
    expect(ctx.share.live?.request.audio).toBe(false);
    expect(ctx.share.wanted?.audio).toBe(false);
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,-)",
    ]);
  });

  it("toggles audio in place: the screen slot's enabled, no new capture", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    ctx.share.toggleAudio();
    await ctx.share.idle();

    expect(ctx.media.log.at(-1)).toBe("enabled:screen:false");
    expect(ctx.sources.browser.capture).toHaveBeenCalledOnce();
    expect(ctx.share.live?.request.audio).toBe(false);
    expect(ctx.named("updated")).toHaveLength(1);
    expect(ctx.phases.at(-1)).toBe("live");
  });

  it("changes quality in place", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    ctx.share.setQuality("720p60");
    await ctx.share.idle();

    expect(ctx.sources.log.at(-1)).toBe("apply-quality:b1:720p60");
    expect(ctx.sources.browser.capture).toHaveBeenCalledOnce();
    expect(ctx.share.live?.request.quality).toBe("720p60");
  });

  it("swaps to a new picker capture: captures first, then releases the old one, then replaces", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: null }));
    ctx.share.start(request({ sourceKey: null }));
    expect(ctx.share.phase).toBe("restarting");
    await ctx.share.idle();

    expect(ctx.sources.log).toEqual([
      "browser-capture:b1:audio=true",
      "apply-quality:b1:1080p30",
      "browser-capture:b2:audio=true",
      "release:b1",
      "apply-quality:b2:1080p30",
    ]);
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
      "replace:screen:tracks(b2-video,b2-audio)",
    ]);
    expect(ctx.named("started")).toMatchObject([
      { restarted: false },
      { restarted: true },
    ]);
  });

  it("keeps the live share when a swap restart's capture fails (picker cancelled)", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: null }));
    ctx.sources.browserSteps.push("throw");
    ctx.share.start(request({ sourceKey: null, quality: "720p30" }));
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("live");
    expect(ctx.share.live?.capture.id).toBe("b1");
    expect(ctx.share.wanted?.quality).toBe("1080p30");
    expect(ctx.sources.released).toEqual([]);
    expect(ctx.named("restart-failed")).toHaveLength(1);
    expect(ctx.named("ended")).toEqual([]);
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
    ]);
  });

  it("releases a desktop capture before restarting it", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: "window:1" }));
    ctx.share.start(request({ sourceKey: "window:2" }));
    await ctx.share.idle();

    expect(ctx.sources.log.slice(2)).toEqual([
      "release:b1",
      "browser-capture:b2:audio=true",
      "apply-quality:b2:1080p30",
    ]);
  });

  it("ends the share and unpublishes when a desktop restart fails", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    ctx.sources.browserSteps.push("throw");
    ctx.share.start(request({ sourceKey: "window:2" }));
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.share.wanted).toBeNull();
    expect(ctx.media.screenOps().at(-1)).toBe("unpublish:screen");
    expect(ctx.named("ended")).toMatchObject([
      { reason: "failed", announced: true },
    ]);
  });

  it("fails to off with the capture released when publishing runs out of retries", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    ctx.media.failures = 3;
    ctx.share.start(request());
    await flush();
    ctx.timers.advance(150);
    await flush();
    ctx.timers.advance(300);
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.named("started")).toEqual([]);
    expect(ctx.named("ended")).toMatchObject([
      { reason: "failed", announced: false },
    ]);
  });

  it("never publishes a capture that lands after a stop during start", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    const capture = deferred();
    ctx.sources.browserSteps.push(capture);
    ctx.share.start(request());
    await flush();
    expect(ctx.share.phase).toBe("starting");
    ctx.share.stop();
    expect(ctx.share.phase).toBe("stopping");
    capture.resolve();
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.media.screenOps()).toEqual([]);
    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.named("started")).toEqual([]);
  });

  it("ends with source-ended when the live capture ends by itself", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    const capture = ctx.share.live!.capture;
    ctx.share.captureEnded({ ...capture, id: "other" });
    await ctx.share.idle();
    expect(ctx.share.phase).toBe("live");

    ctx.share.captureEnded(capture);
    await ctx.share.idle();
    expect(ctx.share.phase).toBe("off");
    expect(ctx.media.screenOps().at(-1)).toBe("unpublish:screen");
    expect(ctx.named("ended")).toMatchObject([
      { reason: "source-ended", announced: true },
    ]);
  });

  it("applies audio and quality asked for during the start once it lands", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    const capture = deferred();
    ctx.sources.browserSteps.push(capture);
    ctx.share.start(request());
    await flush();
    ctx.share.setAudio(false);
    ctx.share.setQuality("720p60");
    capture.resolve();
    await ctx.share.idle();

    expect(ctx.share.live?.request).toMatchObject({
      audio: false,
      quality: "720p60",
    });
    expect(ctx.sources.browser.capture).toHaveBeenCalledOnce();
    expect(ctx.media.log).toContain("enabled:screen:false");
    expect(ctx.sources.log.at(-1)).toBe("apply-quality:b1:720p60");
  });

  it("publishes again on the kept-alive slot after stop and restart", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    ctx.share.stop();
    await ctx.share.idle();
    expect(ctx.media.isPublished("screen")).toBe(true); // keepalive
    await live(ctx);

    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
      "unpublish:screen",
      "publish:screen:tracks(b2-video,b2-audio)",
    ]);
  });

  it("republishes the share after a connection reset", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    ctx.media.published.clear();
    ctx.publication.connectionReset();
    await ctx.publication.reconcile();

    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
      "publish:screen:tracks(b1-video,b1-audio)",
    ]);
  });
});

describe("ScreenShare: native path", () => {
  it("adopts a native share: no publish, and stops pipeline → unpublish → release", async () => {
    const ctx = setup();
    await live(ctx);

    expect(ctx.share.live?.path).toBe("native");
    expect(ctx.media.screenOps()).toEqual([]);
    expect(ctx.publication.appliedFor("screen")?.track).toEqual({
      kind: "native",
    });

    ctx.share.stop();
    await ctx.share.idle();
    const order = [...ctx.sources.log.map((entry) => `src:${entry}`)];
    expect(order.slice(-2)).toEqual(["src:native-stop", "src:release:n1"]);
    expect(ctx.media.screenOps()).toEqual(["unpublish:screen"]);
    expect(ctx.named("ended")).toMatchObject([
      { reason: "stopped", announced: true },
    ]);
  });

  it("restarts the pipeline with the audio flipped (it cannot change in place)", async () => {
    const ctx = setup();
    await live(ctx);
    ctx.share.toggleAudio();
    expect(ctx.share.phase).toBe("restarting");
    await ctx.share.idle();

    expect(ctx.sources.log).toEqual([
      "native-start:n1:audio=true:q=1080p30",
      "native-stop",
      "release:n1",
      "native-start:n2:audio=false:q=1080p30",
    ]);
    expect(ctx.share.live?.request.audio).toBe(false);
    expect(ctx.phases).toEqual([
      "off",
      "starting",
      "live",
      "restarting",
      "live",
    ]);
    expect(ctx.named("started")).toMatchObject([
      { restarted: false },
      { restarted: true },
    ]);
    // Never withdrawn on the way: viewers keep the share.
    expect(ctx.media.screenOps()).toEqual([]);
  });

  it("runs one restart at a time and applies only the latest audio wish", async () => {
    const ctx = setup();
    await live(ctx);
    const first = deferred();
    ctx.sources.nativeSteps.push(first);
    ctx.share.toggleAudio(); // → false, restart in flight
    await flush();
    ctx.share.toggleAudio(); // → true
    ctx.share.toggleAudio(); // → false
    ctx.share.toggleAudio(); // → true
    await flush();
    expect(ctx.sources.native.start).toHaveBeenCalledTimes(2);
    first.resolve();
    await ctx.share.idle();

    expect(
      ctx.sources.native.start.mock.calls.map(([req]) => req.audio),
    ).toEqual([true, false, true]);
    expect(ctx.sources.maxInFlight).toBe(1);
    expect(ctx.share.live?.request.audio).toBe(true);
  });

  it("switches quality in place, and restarts when the pipeline cannot", async () => {
    const ctx = setup();
    await live(ctx);
    ctx.share.setQuality("720p60");
    await ctx.share.idle();
    expect(ctx.sources.native.start).toHaveBeenCalledOnce();
    expect(ctx.share.live?.request.quality).toBe("720p60");
    expect(ctx.named("updated")).toHaveLength(1);

    ctx.sources.qualityInPlace = false;
    ctx.share.setQuality("1440p60");
    await ctx.share.idle();
    expect(ctx.sources.native.start).toHaveBeenCalledTimes(2);
    expect(ctx.sources.log.at(-1)).toBe("native-start:n2:audio=true:q=1440p60");
  });

  it("treats a re-submitted source that only changes quality as a quality change", async () => {
    const ctx = setup();
    await live(ctx);
    ctx.share.start(request({ quality: "720p30" }));
    await ctx.share.idle();
    expect(ctx.sources.native.start).toHaveBeenCalledOnce();
    expect(ctx.sources.log.at(-1)).toBe("native-quality:720p30");

    // The same source with nothing changed is a full restart.
    ctx.share.start(request({ quality: "720p30" }));
    await ctx.share.idle();
    expect(ctx.sources.native.start).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["the publisher throws", "throw"],
    ["the publisher ends inactive", "inactive"],
  ] as const)(
    "fails a restart to off and unpublishes when %s (no fallback)",
    async (_label, step) => {
      const ctx = setup();
      await live(ctx);
      ctx.sources.nativeSteps.push(step);
      ctx.share.toggleAudio();
      await ctx.share.idle();

      expect(ctx.share.phase).toBe("off");
      expect(ctx.sources.nativeActive).toBe(false);
      expect(ctx.sources.browser.capture).not.toHaveBeenCalled();
      expect(ctx.media.screenOps()).toEqual(["unpublish:screen"]);
      expect(ctx.named("ended")).toMatchObject([
        { reason: "failed", announced: true },
      ]);
    },
  );

  it("fails a first start quietly: nothing was published, nothing withdrawn", async () => {
    const ctx = setup();
    ctx.sources.nativeSteps.push("throw");
    ctx.share.start(request());
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.sources.log).toEqual([
      "native-start:n1:audio=true:q=1080p30",
      "native-stop",
    ]);
    expect(ctx.media.screenOps()).toEqual([]);
    expect(ctx.named("ended")).toMatchObject([
      { reason: "failed", announced: false },
    ]);
  });

  it("does not fall back when the pipeline was inactive after it started", async () => {
    const ctx = setup();
    ctx.sources.fallback = true;
    ctx.sources.nativeSteps.push("inactive");
    ctx.share.start(request());
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.sources.browser.capture).not.toHaveBeenCalled();
    expect(ctx.sources.released).toEqual(["n1"]);
    // Stopped anyway: nothing it kept (its reconnect options) survives.
    expect(ctx.sources.log).toEqual([
      "native-start:n1:audio=true:q=1080p30",
      "native-stop",
      "release:n1",
    ]);
    expect(ctx.named("ended")).toMatchObject([
      { reason: "failed", announced: false },
    ]);
  });

  it("stops the pipeline when a restart's native start ends inactive", async () => {
    const ctx = setup();
    await live(ctx);
    ctx.sources.nativeSteps.push("inactive");
    ctx.share.toggleAudio();
    await ctx.share.idle();

    expect(ctx.sources.log.slice(-3)).toEqual([
      "native-start:n2:audio=false:q=1080p30",
      "native-stop",
      "release:n2",
    ]);
    expect(ctx.share.phase).toBe("off");
  });

  it("withdraws a live browser share before a native restart publishes the same names", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: "device:1" }));
    ctx.sources.nativeEligible = true;
    let publishedAtNativeStart: PublicationValue<string> | null | "unset" =
      "unset";
    let opsAtNativeStart: string[] = [];
    let sourceLogAtNativeStart: string[] = [];
    ctx.sources.native.start.mockImplementationOnce(async () => {
      publishedAtNativeStart = ctx.media.published.get("screen") ?? null;
      opsAtNativeStart = ctx.media.screenOps();
      sourceLogAtNativeStart = [...ctx.sources.log];
      ctx.sources.nativeActive = true;
      return { id: "nX", path: "native", video: null, audio: null };
    });
    ctx.share.start(request({ sourceKey: "window:2" }));
    await ctx.share.idle();

    // Withdrawn (the video parked on its keepalive), then released.
    expect(publishedAtNativeStart).toBeNull();
    expect(opsAtNativeStart).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
      "unpublish:screen",
    ]);
    expect(sourceLogAtNativeStart.at(-1)).toBe("release:b1");
    expect(ctx.share.live?.path).toBe("native");
    expect(ctx.publication.appliedFor("screen")?.track).toEqual({
      kind: "native",
    });
    expect(ctx.named("started")).toMatchObject([
      { restarted: false },
      { restarted: true },
    ]);
    expect(ctx.named("ended")).toEqual([]);

    // Stopping withdraws the native names; a browser share afterwards
    // publishes on the kept-alive slot again.
    ctx.share.stop();
    await ctx.share.idle();
    expect(ctx.sources.log.slice(-2)).toEqual(["native-stop", "release:nX"]);
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: "device:1" }));
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
      "unpublish:screen",
      "unpublish:screen",
      "publish:screen:tracks(b2-video,b2-audio)",
    ]);
  });

  it("republishes the withdrawn browser share when the native restart falls back", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    ctx.sources.fallback = true;
    await live(ctx, request({ sourceKey: "device:1" }));
    ctx.sources.nativeEligible = true;
    ctx.sources.nativeSteps.push("throw");
    ctx.share.start(request({ sourceKey: "window:2" }));
    await ctx.share.idle();

    expect(ctx.share.live?.path).toBe("browser");
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
      "unpublish:screen",
      "publish:screen:tracks(b3-video,b3-audio)",
    ]);
    expect(ctx.named("ended")).toEqual([]);
  });

  it("ends the share when a native restart over a browser share fails", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: "device:1" }));
    ctx.sources.nativeEligible = true;
    ctx.sources.nativeSteps.push("throw");
    ctx.share.start(request({ sourceKey: "window:2" }));
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
      "unpublish:screen",
    ]);
    expect(ctx.named("ended")).toMatchObject([
      { reason: "failed", announced: true },
    ]);
  });

  it("falls back to the browser path when the native start throws and fallback is allowed", async () => {
    const ctx = setup();
    ctx.sources.fallback = true;
    await live(ctx);
    ctx.sources.nativeSteps.push("throw");
    ctx.share.start(request());
    await ctx.share.idle();

    expect(ctx.sources.log.slice(1)).toEqual([
      "native-stop",
      "release:n1",
      "native-start:n2:audio=true:q=1080p30",
      "native-stop",
      "browser-capture:b3:audio=true",
      "apply-quality:b3:1080p30",
    ]);
    expect(ctx.share.live?.path).toBe("browser");
    // The adopted native share is replaced by the browser capture.
    expect(ctx.media.screenOps()).toEqual([
      "replace:screen:tracks(b3-video,b3-audio)",
    ]);
    expect(ctx.errors).toContain("native-start");
  });

  it("fails to off when the CEF fallback throws too", async () => {
    const ctx = setup();
    ctx.sources.fallback = true;
    await live(ctx);
    ctx.sources.nativeSteps.push("throw");
    ctx.sources.browserSteps.push("throw");
    ctx.share.start(request());
    await ctx.share.idle();

    expect(ctx.sources.browser.capture).toHaveBeenCalledOnce();
    expect(ctx.share.phase).toBe("off");
    expect(ctx.media.screenOps()).toEqual(["unpublish:screen"]);
    expect(ctx.named("ended")).toMatchObject([{ reason: "failed" }]);
  });

  it("skips the native path when the request does not prefer it", async () => {
    const ctx = setup();
    await live(ctx, request({ preferNative: false }));
    expect(ctx.sources.native.eligible).not.toHaveBeenCalled();
    expect(ctx.share.live?.path).toBe("browser");
  });

  it("stops after a restart in flight lands, without announcing it", async () => {
    const ctx = setup();
    await live(ctx);
    const restart = deferred();
    ctx.sources.nativeSteps.push(restart);
    ctx.share.toggleAudio();
    await flush();
    ctx.share.stop();
    expect(ctx.share.phase).toBe("stopping");
    restart.resolve();
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.sources.log.slice(-3)).toEqual([
      "native-start:n2:audio=false:q=1080p30",
      "native-stop",
      "release:n2",
    ]);
    expect(ctx.media.screenOps()).toEqual(["unpublish:screen"]);
    expect(ctx.named("started")).toHaveLength(1);
    expect(ctx.named("ended")).toMatchObject([
      { reason: "stopped", announced: true },
    ]);
  });

  it("stops a native share that lands after a stop during start", async () => {
    const ctx = setup();
    const start = deferred();
    ctx.sources.nativeSteps.push(start);
    ctx.share.start(request());
    await flush();
    ctx.share.stop();
    start.resolve();
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.sources.nativeActive).toBe(false);
    expect(ctx.media.screenOps()).toEqual(["unpublish:screen"]);
    expect(ctx.named("started")).toEqual([]);
    expect(ctx.named("ended")).toMatchObject([{ announced: false }]);
  });

  it("does not fall back when the share was stopped while the native start failed", async () => {
    const ctx = setup();
    ctx.sources.fallback = true;
    const start = deferred();
    ctx.sources.nativeSteps.push(start);
    ctx.share.start(request());
    await flush();
    ctx.share.stop();
    start.reject(new Error("superseded"));
    await ctx.share.idle();

    expect(ctx.sources.browser.capture).not.toHaveBeenCalled();
    expect(ctx.share.phase).toBe("off");
  });
});

describe("ScreenShare: commands during a step", () => {
  it("starts nothing when stopped while the restart probes the native source", async () => {
    const ctx = setup();
    await live(ctx);
    const probe = deferred<boolean>();
    ctx.sources.native.eligible.mockImplementationOnce(() => probe.promise);
    ctx.share.toggleAudio();
    await flush();
    ctx.share.stop();
    probe.resolve(true);
    await ctx.share.idle();

    expect(ctx.sources.native.start).toHaveBeenCalledOnce();
    expect(ctx.share.phase).toBe("off");
    expect(ctx.media.screenOps()).toEqual(["unpublish:screen"]);
    expect(ctx.named("ended")).toMatchObject([{ reason: "stopped" }]);
  });

  it("captures only the newest request when replaced while probing", async () => {
    const ctx = setup();
    const probe = deferred<boolean>();
    ctx.sources.native.eligible.mockImplementationOnce(() => probe.promise);
    ctx.share.start(request({ sourceKey: "window:1" }));
    await flush();
    ctx.share.start(request({ sourceKey: "window:2" }));
    probe.resolve(true);
    await ctx.share.idle();

    expect(ctx.sources.native.start).toHaveBeenCalledOnce();
    expect(ctx.sources.native.start.mock.calls[0]?.[0].sourceKey).toBe(
      "window:2",
    );
    expect(ctx.share.live?.request.sourceKey).toBe("window:2");
  });

  it("publishes and withdraws the share while another slot keeps failing", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    // The microphone's publish always fails; the screen still goes out.
    const publish = ctx.media.publish.bind(ctx.media);
    ctx.media.publish = async (slot, value) => {
      if (slot === "microphone") {
        ctx.media.log.push("publish:microphone:fail");
        throw new Error("mic down");
      }
      return publish(slot, value);
    };
    ctx.publication.setTrack("microphone", "mic");
    ctx.share.start(request());
    for (let i = 0; i < 6; i += 1) {
      await flush();
      ctx.timers.advance(1_000);
    }
    await ctx.share.idle();
    expect(ctx.share.phase).toBe("live");
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b1-video,b1-audio)",
    ]);

    ctx.share.stop();
    for (let i = 0; i < 6; i += 1) {
      await flush();
      ctx.timers.advance(1_000);
    }
    await ctx.share.idle();
    expect(ctx.media.screenOps().at(-1)).toBe("unpublish:screen");
  });
});

describe("ScreenShare: superseded captures", () => {
  it("never publishes a capture that lands after stop() and a newer start()", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    const first = deferred();
    ctx.sources.browserSteps.push(first);
    ctx.share.start(request({ sourceKey: null }));
    await flush();
    ctx.share.stop();
    ctx.share.start(request({ sourceKey: null, quality: "720p30" }));
    first.resolve();
    await ctx.share.idle();

    expect(ctx.share.live?.capture.id).toBe("b2");
    expect(
      ctx
        .named("started")
        .map((event) =>
          event.type === "started" ? event.share.capture.id : null,
        ),
    ).toEqual(["b2"]);
    expect(ctx.named("started")).toMatchObject([{ restarted: false }]);
    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.media.screenOps()).toEqual([
      "publish:screen:tracks(b2-video,b2-audio)",
    ]);
  });

  it("does not bring back a stopped capture when the newer start is cancelled", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    const first = deferred();
    ctx.sources.browserSteps.push(first, "throw");
    ctx.share.start(request({ sourceKey: null }));
    await flush();
    ctx.share.stop();
    ctx.share.start(request({ sourceKey: null }));
    first.resolve();
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.share.wanted).toBeNull();
    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.named("started")).toEqual([]);
    expect(ctx.media.screenOps()).toEqual([]);
    expect(ctx.named("ended")).toMatchObject([
      { reason: "failed", announced: false },
    ]);
  });

  it("stops a native capture a newer start replaced, then runs the newer one", async () => {
    const ctx = setup();
    const first = deferred();
    ctx.sources.nativeSteps.push(first);
    ctx.share.start(request({ sourceKey: "window:1" }));
    await flush();
    ctx.share.start(request({ sourceKey: "window:2" }));
    first.resolve();
    await ctx.share.idle();

    expect(ctx.sources.log).toEqual([
      "native-start:n1:audio=true:q=1080p30",
      "native-stop",
      "release:n1",
      "native-start:n2:audio=true:q=1080p30",
    ]);
    expect(ctx.share.live?.request.sourceKey).toBe("window:2");
    expect(ctx.named("started")).toMatchObject([{ restarted: false }]);
    expect(ctx.media.screenOps()).toEqual([]);
  });

  it("keeps a newer start queued when the live capture ends by itself", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: "device:1" }));
    const a = ctx.share.live!.capture;
    const step = deferred();
    ctx.sources.browser.applyQuality.mockImplementationOnce(() => step.promise);
    ctx.share.setQuality("720p30");
    await flush();
    ctx.share.start(request({ sourceKey: "device:2" }));
    ctx.share.captureEnded(a);
    step.resolve();
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("live");
    expect(ctx.share.live?.request.sourceKey).toBe("device:2");
    expect(ctx.named("ended")).toEqual([]);
    expect(ctx.named("started")).toMatchObject([
      { restarted: false },
      { restarted: true },
    ]);
  });

  it("still ends with source-ended when only the ended capture's audio or quality changed", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx, request({ sourceKey: "device:1" }));
    const a = ctx.share.live!.capture;
    const step = deferred();
    ctx.sources.browser.applyQuality.mockImplementationOnce(() => step.promise);
    ctx.share.setQuality("720p30");
    await flush();
    ctx.share.setAudio(false);
    ctx.share.captureEnded(a);
    step.resolve();
    await ctx.share.idle();

    expect(ctx.share.phase).toBe("off");
    expect(ctx.named("ended")).toMatchObject([
      { reason: "source-ended", announced: true },
    ]);
  });
});

describe("ScreenShare: dispose", () => {
  it("releases the live capture and emits nothing", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    const before = ctx.events.length;
    ctx.share.dispose();

    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.events.length).toBe(before);
    expect(ctx.share.phase).toBe("off");
    // Withdrawing is the media session's job on leave.
    expect(ctx.media.screenOps()).not.toContain("unpublish:screen");
    expect(ctx.sources.native.stop).not.toHaveBeenCalled();
  });

  it("releases a capture that lands after dispose and never publishes it", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    const capture = deferred();
    ctx.sources.browserSteps.push(capture);
    ctx.share.start(request());
    await flush();
    ctx.share.dispose();
    capture.resolve();
    await flush();

    expect(ctx.sources.released).toEqual(["b1"]);
    expect(ctx.media.screenOps()).toEqual([]);
    ctx.share.start(request());
    await ctx.share.idle();
    expect(ctx.sources.browser.capture).toHaveBeenCalledOnce();
  });

  it("ends itself when the publication is disposed with the session", async () => {
    const ctx = setup();
    ctx.sources.nativeEligible = false;
    await live(ctx);
    ctx.publication.dispose();
    ctx.share.stop();
    await ctx.share.idle();
    expect(ctx.share.isDisposed).toBe(true);
    expect(ctx.sources.released).toEqual(["b1"]);
  });
});

describe("planPublication: the screen slot", () => {
  const share: ScreenPublication<string> = {
    kind: "tracks",
    video: "v",
    audio: "a",
  };
  const nothing = { track: null, enabled: true } as const;

  it("plans the screen after microphone and camera", () => {
    expect(
      planPublication(
        {
          microphone: { track: "mic", enabled: true },
          camera: nothing,
          screen: { track: share, enabled: false },
        },
        {},
        () => false,
      ),
    ).toEqual([
      { kind: "publish", slot: "microphone", track: "mic" },
      { kind: "set-enabled", slot: "microphone", enabled: true },
      { kind: "publish", slot: "screen", track: share },
      { kind: "set-enabled", slot: "screen", enabled: false },
    ]);
  });

  it("does not unpublish a withdrawn share whose sender is kept alive", () => {
    expect(
      planPublication(
        { microphone: nothing, camera: nothing, screen: nothing },
        { screen: { track: null, enabled: null } },
        (slot) => slot === "screen",
      ),
    ).toEqual([]);
  });

  it("treats a missing screen intent as nothing wanted", () => {
    expect(
      planPublication(
        { microphone: nothing, camera: nothing },
        { screen: { track: share, enabled: true } },
        () => false,
      ),
    ).toEqual([{ kind: "unpublish", slot: "screen" }]);
  });
});

describe("screenShareSubscription", () => {
  it.each([
    [false, false, false, false, false, false],
    [true, false, false, false, true, false],
    [false, true, true, false, true, true],
    [false, false, true, false, false, true],
    [false, false, false, true, false, true],
  ])(
    "watched=%s shareFocused=%s participantFocused=%s alwaysHear=%s → video=%s audible=%s",
    (watched, shareFocused, participantFocused, alwaysHear, video, audible) => {
      expect(
        screenShareSubscription({
          watched,
          shareFocused,
          participantFocused,
          alwaysHear,
        }),
      ).toEqual({ video, audio: true, audible });
    },
  );
});
