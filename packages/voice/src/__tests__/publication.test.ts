import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUBLICATION_RETRY,
  PublicationReconciler,
  planPublication,
  publicationRetryDelay,
  type AppliedPublications,
  type PublicationIntent,
  type PublicationMedia,
  type PublicationSlot,
  type ReconcileResult,
} from "../publication";
import { FakeTimers, flush } from "./fake-timers";

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** What a publish/replace/unpublish does: succeed, throw, find nothing, or wait. */
type Step = "ok" | "throw" | "missing" | Deferred;

/**
 * A media session like web's PartyTracks: unpublishing the camera withdraws
 * it but keeps its sender alive (keepalive), and `isPublished` reports that
 * sender, so the camera still reads as published after an unpublish.
 */
class FakeMedia implements PublicationMedia<string> {
  readonly log: string[] = [];
  readonly published = new Map<PublicationSlot, string>();
  /** Withdrawn slots whose sender is kept alive. */
  readonly keptAlive = new Set<PublicationSlot>();
  readonly enabled = new Map<PublicationSlot, boolean>();
  readonly steps: Step[] = [];

  constructor(
    private readonly keepAlive: ReadonlySet<PublicationSlot> = new Set([
      "camera",
    ]),
  ) {}

  private async step(entry: string, apply: () => void): Promise<boolean> {
    this.log.push(entry);
    const step = this.steps.shift() ?? "ok";
    if (step === "throw") throw new Error(`${entry} failed`);
    if (step === "missing") return false;
    if (step !== "ok") await step.promise;
    apply();
    return true;
  }

  async publish(slot: PublicationSlot, track: string): Promise<void> {
    await this.step(`publish:${slot}:${track}`, () => {
      this.keptAlive.delete(slot);
      this.published.set(slot, track);
    });
  }

  replace(slot: PublicationSlot, track: string): Promise<boolean> {
    return this.step(`replace:${slot}:${track}`, () =>
      this.published.set(slot, track),
    );
  }

  async unpublish(slot: PublicationSlot): Promise<void> {
    await this.step(`unpublish:${slot}`, () => {
      if (this.published.delete(slot) && this.keepAlive.has(slot)) {
        this.keptAlive.add(slot);
      }
    });
  }

  setEnabled(slot: PublicationSlot, enabled: boolean): void {
    this.log.push(`enabled:${slot}:${enabled}`);
    this.enabled.set(slot, enabled);
  }

  isPublished(slot: PublicationSlot): boolean {
    return this.published.has(slot) || this.keptAlive.has(slot);
  }
}

const NOTHING = { track: null, enabled: true } as const;

function intent(
  microphone: { track: string | null; enabled: boolean } = NOTHING,
  camera: { track: string | null; enabled: boolean } = NOTHING,
): PublicationIntent<string> {
  return { microphone, camera };
}

describe("planPublication", () => {
  const never = () => false;

  it("does nothing when nothing is wanted or published", () => {
    expect(planPublication(intent(), {}, never)).toEqual([]);
  });

  it("publishes a wanted track nothing is known about, then sets enabled", () => {
    expect(
      planPublication(intent({ track: "mic", enabled: false }), {}, never),
    ).toEqual([
      { kind: "publish", slot: "microphone", track: "mic" },
      { kind: "set-enabled", slot: "microphone", enabled: false },
    ]);
  });

  it("publishes (not replaces) after a reset even if the media still has one", () => {
    expect(
      planPublication(
        intent({ track: "mic", enabled: true }),
        {},
        (slot) => slot === "microphone",
      ),
    ).toEqual([
      { kind: "publish", slot: "microphone", track: "mic" },
      { kind: "set-enabled", slot: "microphone", enabled: true },
    ]);
  });

  it("replaces a different track this connection published", () => {
    const applied: AppliedPublications<string> = {
      microphone: { track: "old", enabled: true },
    };
    expect(
      planPublication(intent({ track: "new", enabled: true }), applied, never),
    ).toEqual([
      { kind: "replace", slot: "microphone", track: "new" },
      { kind: "set-enabled", slot: "microphone", enabled: true },
    ]);
  });

  it("only sets enabled when the track already matches", () => {
    const applied: AppliedPublications<string> = {
      microphone: { track: "mic", enabled: true },
    };
    expect(
      planPublication(intent({ track: "mic", enabled: true }), applied, never),
    ).toEqual([]);
    expect(
      planPublication(intent({ track: "mic", enabled: false }), applied, never),
    ).toEqual([{ kind: "set-enabled", slot: "microphone", enabled: false }]);
  });

  it("unpublishes what this connection or the media session has", () => {
    expect(
      planPublication(
        intent(),
        { camera: { track: "cam", enabled: true } },
        never,
      ),
    ).toEqual([{ kind: "unpublish", slot: "camera" }]);
    expect(planPublication(intent(), {}, (slot) => slot === "camera")).toEqual([
      { kind: "unpublish", slot: "camera" },
    ]);
    expect(
      planPublication(
        intent(),
        { camera: { track: null, enabled: null } },
        never,
      ),
    ).toEqual([]);
  });

  it("does not unpublish again what this connection already unpublished", () => {
    // A withdrawn camera kept alive still has a sender: the media session
    // reports it as published, and the plan must still come out empty.
    expect(
      planPublication(
        intent(),
        { camera: { track: null, enabled: null } },
        (slot) => slot === "camera",
      ),
    ).toEqual([]);
  });

  it("orders the microphone before the camera", () => {
    const ops = planPublication(
      intent({ track: "mic", enabled: true }, { track: "cam", enabled: true }),
      {},
      never,
    );
    expect(ops.map((op) => `${op.kind}:${op.slot}`)).toEqual([
      "publish:microphone",
      "set-enabled:microphone",
      "publish:camera",
      "set-enabled:camera",
    ]);
  });
});

describe("publicationRetryDelay", () => {
  it("doubles from the base delay up to the cap", () => {
    expect(publicationRetryDelay(1)).toBe(150);
    expect(publicationRetryDelay(2)).toBe(300);
    expect(publicationRetryDelay(10)).toBe(PUBLICATION_RETRY.maxDelayMs);
  });
});

describe("PublicationReconciler", () => {
  let timers: FakeTimers;
  let media: FakeMedia;
  let onOpError: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  let reconciler: PublicationReconciler<string>;

  beforeEach(() => {
    timers = new FakeTimers();
    media = new FakeMedia();
    onOpError = vi.fn();
    reconciler = new PublicationReconciler({ media, timers, onOpError });
  });

  async function settle(
    result: Promise<ReconcileResult<string>>,
  ): Promise<ReconcileResult<string>> {
    await flush();
    return result;
  }

  it("publishes the initial microphone and applies its mute state", async () => {
    reconciler.setTrack("microphone", "mic");
    reconciler.setEnabled("microphone", false);
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.log).toEqual([
      "publish:microphone:mic",
      "enabled:microphone:false",
    ]);
  });

  it("does nothing when everything already matches", async () => {
    reconciler.setTrack("microphone", "mic");
    await settle(reconciler.reconcile());
    media.log.length = 0;
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.log).toEqual([]);
  });

  it("replaces a changed microphone and publishes, then unpublishes, the camera", async () => {
    reconciler.setTrack("microphone", "mic-a");
    await settle(reconciler.reconcile());
    media.log.length = 0;

    reconciler.setTrack("microphone", "mic-b");
    reconciler.setTrack("camera", "cam");
    await settle(reconciler.reconcile());
    expect(media.log).toEqual([
      "replace:microphone:mic-b",
      "enabled:microphone:true",
      "publish:camera:cam",
      "enabled:camera:true",
    ]);

    media.log.length = 0;
    reconciler.setTrack("camera", null);
    await settle(reconciler.reconcile());
    expect(media.log).toEqual(["unpublish:camera"]);
    expect(media.published.has("camera")).toBe(false);
  });

  it("converges after withdrawing a camera whose sender is kept alive", async () => {
    reconciler.setTrack("camera", "cam");
    await settle(reconciler.reconcile());
    media.log.length = 0;

    reconciler.setTrack("camera", null);
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.isPublished("camera")).toBe(true);
    expect(media.log).toEqual(["unpublish:camera"]);

    // Later runs leave it alone.
    media.log.length = 0;
    reconciler.setTrack("microphone", "mic");
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.log).toEqual([
      "publish:microphone:mic",
      "enabled:microphone:true",
    ]);
  });

  it("withdraws a kept-alive camera once after a reset, then converges", async () => {
    reconciler.setTrack("camera", "cam");
    await settle(reconciler.reconcile());
    reconciler.setTrack("camera", null);
    await settle(reconciler.reconcile());
    media.log.length = 0;

    reconciler.connectionReset();
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    // Nothing is known on the new connection and the media session reports
    // the kept-alive sender: one unpublish, then nothing.
    expect(media.log).toEqual(["unpublish:camera"]);
  });

  it("publishes the camera again over its kept-alive sender", async () => {
    reconciler.setTrack("camera", "cam-a");
    await settle(reconciler.reconcile());
    reconciler.setTrack("camera", null);
    await settle(reconciler.reconcile());
    media.log.length = 0;

    reconciler.setTrack("camera", "cam-b");
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.log).toEqual(["publish:camera:cam-b", "enabled:camera:true"]);
    expect(media.keptAlive.has("camera")).toBe(false);
  });

  it("applies a mute at once without moving any generation", async () => {
    reconciler.setTrack("microphone", "mic");
    await settle(reconciler.reconcile());
    const generation = reconciler.generation;
    media.log.length = 0;

    reconciler.setEnabled("microphone", false);
    expect(media.log).toEqual(["enabled:microphone:false"]);
    expect(reconciler.generation).toEqual(generation);
    expect(reconciler.isCurrent(generation, "microphone")).toBe(true);
    // Applied already: a reconcile has nothing to do.
    await settle(reconciler.reconcile());
    expect(media.log).toEqual(["enabled:microphone:false"]);
  });

  it("applies the latest mute state when a publish in flight completes", async () => {
    const publish = deferred();
    media.steps.push(publish);
    reconciler.setTrack("microphone", "mic");
    const result = reconciler.reconcile();
    await flush();

    // Nothing is published yet, so nothing to mute.
    reconciler.setEnabled("microphone", false);
    expect(media.log).toEqual(["publish:microphone:mic"]);

    publish.resolve();
    expect(await settle(result)).toEqual({ status: "converged" });
    expect(media.log).toEqual([
      "publish:microphone:mic",
      "enabled:microphone:false",
    ]);
  });

  it("keeps a recovery current when the user mutes during it", async () => {
    reconciler.setTrack("microphone", "processed");
    await settle(reconciler.reconcile());
    media.log.length = 0;

    // Stall recovery: replace the processed track with a recovery track.
    const replace = deferred();
    media.steps.push(replace);
    reconciler.setTrack("microphone", "recovery");
    const generation = reconciler.generation;
    const result = reconciler.reconcile();
    await flush();

    reconciler.setEnabled("microphone", false);
    expect(reconciler.isCurrent(generation, "microphone")).toBe(true);

    replace.resolve();
    expect(await settle(result)).toEqual({ status: "converged" });
    expect(reconciler.isCurrent(generation, "microphone")).toBe(true);
    expect(media.published.get("microphone")).toBe("recovery");
    expect(media.log).toEqual([
      "replace:microphone:recovery",
      // the mute lands on the old track at once …
      "enabled:microphone:false",
      // … and again on the recovery track once it is in.
      "enabled:microphone:false",
    ]);
  });

  it("re-plans with the newest track when the intent changes mid-operation", async () => {
    const publish = deferred();
    media.steps.push(publish);
    reconciler.setTrack("microphone", "first");
    const generation = reconciler.generation;
    const result = reconciler.reconcile();
    await flush();

    reconciler.setTrack("microphone", "second");
    expect(reconciler.isCurrent(generation, "microphone")).toBe(false);
    publish.resolve();
    expect(await settle(result)).toEqual({ status: "converged" });
    expect(media.log).toEqual([
      "publish:microphone:first",
      "replace:microphone:second",
      "enabled:microphone:true",
    ]);
  });

  it("returns to the earlier track when a caller reverts its intent", async () => {
    reconciler.setTrack("microphone", "committed");
    await settle(reconciler.reconcile());
    reconciler.setTrack("microphone", "candidate");
    await settle(reconciler.reconcile());
    reconciler.setTrack("microphone", "committed");
    await settle(reconciler.reconcile());
    expect(media.published.get("microphone")).toBe("committed");
  });

  it("republishes everything wanted after a connection reset", async () => {
    reconciler.setTrack("microphone", "mic");
    reconciler.setTrack("camera", "cam");
    reconciler.setEnabled("microphone", false);
    await settle(reconciler.reconcile());
    media.log.length = 0;

    reconciler.connectionReset();
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.log).toEqual([
      "publish:microphone:mic",
      "enabled:microphone:false",
      "publish:camera:cam",
      "enabled:camera:true",
    ]);
  });

  it("abandons a publish in flight when the connection resets mid-publish", async () => {
    const stale = deferred();
    media.steps.push(stale);
    reconciler.setTrack("microphone", "mic");
    const before = reconciler.generation;
    const result = reconciler.reconcile();
    await flush();

    reconciler.connectionReset();
    await flush();
    // The new connection publishes without waiting for the old attempt.
    expect(media.log).toEqual([
      "publish:microphone:mic",
      "publish:microphone:mic",
      "enabled:microphone:true",
    ]);
    // The caller's intent still stands: it is published again, not dropped.
    expect(reconciler.isCurrent(before, "microphone")).toBe(true);
    expect(reconciler.generation.connection).toBe(before.connection + 1);
    expect(await settle(result)).toEqual({ status: "converged" });

    // The old attempt finishing late changes nothing.
    media.log.length = 0;
    stale.resolve();
    await flush();
    expect(media.log).toEqual([]);
    expect(reconciler.appliedFor("microphone")).toEqual({
      track: "mic",
      enabled: true,
    });
  });

  it("retries a failed publish with backoff and converges", async () => {
    media.steps.push("throw", "throw");
    reconciler.setTrack("microphone", "mic");
    const result = reconciler.reconcile();
    await flush();
    expect(media.log).toEqual(["publish:microphone:mic"]);

    timers.advance(149);
    await flush();
    expect(media.log).toHaveLength(1);
    timers.advance(1);
    await flush();
    expect(media.log).toHaveLength(2);

    timers.advance(300);
    expect(await settle(result)).toEqual({ status: "converged" });
    expect(media.log).toEqual([
      "publish:microphone:mic",
      "publish:microphone:mic",
      "publish:microphone:mic",
      "enabled:microphone:true",
    ]);
    expect(onOpError).toHaveBeenCalledTimes(2);
  });

  it("sets a spent slot aside and still converges the others in the same run", async () => {
    media.steps.push("throw", "throw", "throw");
    reconciler.setTrack("microphone", "mic");
    reconciler.setTrack("camera", "cam");
    const result = reconciler.reconcile();
    await flush();
    timers.advance(150);
    await flush();
    timers.advance(300);
    const failed = await settle(result);

    expect(failed.status === "failed" && failed.failedSlots).toEqual([
      "microphone",
    ]);
    expect(media.published.get("camera")).toBe("cam");
    expect(media.published.has("microphone")).toBe(false);
  });

  it("gives up after the retry budget and starts afresh on the next reconcile", async () => {
    media.steps.push("throw", "throw", "throw");
    reconciler.setTrack("microphone", "mic");
    const result = reconciler.reconcile();
    await flush();
    timers.advance(150);
    await flush();
    timers.advance(300);
    const failed = await settle(result);
    expect(failed.status).toBe("failed");
    expect(failed.status === "failed" && failed.op).toEqual({
      kind: "publish",
      slot: "microphone",
      track: "mic",
    });
    expect(reconciler.intentFor("microphone").track).toBe("mic");
    expect(timers.size).toBe(0);

    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.published.get("microphone")).toBe("mic");
  });

  it("publishes when a replacement finds no publication", async () => {
    reconciler.setTrack("microphone", "a");
    await settle(reconciler.reconcile());
    media.log.length = 0;

    media.steps.push("missing");
    reconciler.setTrack("microphone", "b");
    expect(await settle(reconciler.reconcile())).toEqual({
      status: "converged",
    });
    expect(media.log).toEqual([
      "replace:microphone:b",
      "publish:microphone:b",
      "enabled:microphone:true",
    ]);
    expect(onOpError).not.toHaveBeenCalled();
  });

  it("retries a failed unpublish", async () => {
    reconciler.setTrack("camera", "cam");
    await settle(reconciler.reconcile());
    media.log.length = 0;

    media.steps.push("throw");
    reconciler.setTrack("camera", null);
    const result = reconciler.reconcile();
    await flush();
    timers.advance(150);
    expect(await settle(result)).toEqual({ status: "converged" });
    expect(media.log).toEqual(["unpublish:camera", "unpublish:camera"]);
  });

  it("does not wait out a backoff when the intent changes", async () => {
    media.steps.push("throw");
    reconciler.setTrack("microphone", "a");
    const result = reconciler.reconcile();
    await flush();
    expect(timers.size).toBe(1);

    reconciler.setTrack("microphone", "b");
    // The new intent alone ends the wait.
    expect(timers.size).toBe(0);
    const second = reconciler.reconcile();
    await flush();
    expect(await settle(result)).toEqual({ status: "converged" });
    expect(await settle(second)).toEqual({ status: "converged" });
    expect(media.log).toEqual([
      "publish:microphone:a",
      "publish:microphone:b",
      "enabled:microphone:true",
    ]);
  });

  it("replaces an adopted track instead of publishing beside it", async () => {
    reconciler.adopt("microphone", "standby-silence");
    expect(reconciler.intentFor("microphone").track).toBe("standby-silence");
    reconciler.setTrack("microphone", "live-mic");
    await settle(reconciler.reconcile());
    expect(media.log).toEqual([
      "replace:microphone:live-mic",
      "enabled:microphone:true",
    ]);
  });

  it("stops for good once disposed", async () => {
    const publish = deferred();
    media.steps.push(publish);
    reconciler.setTrack("microphone", "mic");
    const result = reconciler.reconcile();
    await flush();

    reconciler.dispose();
    expect(await settle(result)).toEqual({ status: "disposed" });
    publish.resolve();
    await flush();
    reconciler.setTrack("camera", "cam");
    reconciler.setEnabled("microphone", false);
    expect(await reconciler.reconcile()).toEqual({ status: "disposed" });
    expect(media.log).toEqual(["publish:microphone:mic"]);
  });
});
