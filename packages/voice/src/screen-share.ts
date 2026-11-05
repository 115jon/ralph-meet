// One client's screen share: start, restart, audio, quality, stop and
// failure as one serialized state machine over injected capture sources
// (the native pipeline and the platform's media stack). What it publishes
// goes through the publication reconciler's `screen` slot. No React, no
// DOM. See SCREEN_SHARE.md.

import type { PublicationReconciler, ScreenPublication } from "./publication";

/**
 * - `off`: no share.
 * - `starting`: the first capture is in flight; nothing was announced yet.
 * - `live`: a share is captured and published; nothing is in flight.
 * - `restarting`: a share was announced and a new capture for it is in
 *   flight (another source, or a native audio or quality change).
 * - `stopping`: the share is being withdrawn and released, or a stop is
 *   waiting for the capture in flight to land so it can be released.
 */
export type ScreenSharePhase =
  | "off"
  | "starting"
  | "live"
  | "restarting"
  | "stopping";

/** Who captures and publishes a share. */
export type ScreenSharePath = "native" | "browser";

export interface ScreenShareRequest<S> {
  /** The platform's description of what to capture (web: the picker's source). */
  readonly source: S;
  /**
   * Identifies the source across requests (web: the desktop source id);
   * null when the platform's picker chooses (web: getDisplayMedia).
   */
  readonly sourceKey: string | null;
  /** The platform's quality preset (web: "1080p60"). */
  readonly quality: string;
  /** Whether the share carries the source's audio. */
  readonly audio: boolean;
  /** False: capture through the browser path only, never the native one. */
  readonly preferNative: boolean;
}

/** What one capture produced. The platform may carry more (web: the preview). */
export interface ScreenCapture<T> {
  readonly path: ScreenSharePath;
  /** Browser captures: the video track to publish. Native: null. */
  readonly video: T | null;
  /** Browser captures: the audio track, when the capture has one. Native: null. */
  readonly audio: T | null;
}

/**
 * The native pipeline (web desktop: the Rust hardware publisher). It
 * captures, encodes and publishes a share by itself, so `start` resolving
 * means the share is on the wire. Every method may throw.
 */
export interface NativeScreenSource<S, C> {
  /** Whether `request` can use the native pipeline at all. */
  eligible(request: ScreenShareRequest<S>): Promise<boolean> | boolean;
  /** Captures and publishes `request`. Throws when it could not. */
  start(request: ScreenShareRequest<S>): Promise<C>;
  /** Whether the pipeline holds a share right now. */
  isActive(): boolean;
  /** Stops the pipeline and what it published. Idempotent. */
  stop(): Promise<void>;
  /** Switches the live share's quality in place; false: could not. */
  updateQuality(quality: string): Promise<boolean>;
  /** Whether a failed native start may fall back to the browser path. */
  fallbackAllowed(): boolean;
}

/** The platform's media stack (web: getDisplayMedia, CEF desktop capture). */
export interface BrowserScreenSource<S, C> {
  /** Captures `request`. Throws when it could not (or the user cancelled). */
  capture(request: ScreenShareRequest<S>): Promise<C>;
  /** Applies `quality` to a live capture and its publication. */
  applyQuality(capture: C, quality: string): Promise<void> | void;
}

export interface ScreenShareSources<S, C> {
  readonly native: NativeScreenSource<S, C> | null;
  readonly browser: BrowserScreenSource<S, C>;
  /**
   * True when the capture for `request` cannot run beside the live one, so
   * the live one is released before the new one starts (web desktop: a
   * picked window or monitor). False: the new one is captured first and the
   * old one released once it is ready, so a cancelled picker keeps the share.
   */
  releaseBeforeRestart(request: ScreenShareRequest<S>): boolean;
  /** Whether a capture still produces video. */
  isLive(capture: C): boolean;
  /** Stops a capture's local tracks. Never touches what is published. */
  release(capture: C): void;
}

export type ScreenShareEndReason =
  /** `stop()`: the user stopped sharing. */
  | "stopped"
  /** The capture ended by itself (window closed, browser "Stop sharing"). */
  | "source-ended"
  /** A start or restart failed with nothing left to show. */
  | "failed";

export interface LiveScreenShare<S, C> {
  /** The request as applied; `audio` is whether the share carries audio. */
  readonly request: ScreenShareRequest<S>;
  readonly capture: C;
  readonly path: ScreenSharePath;
}

export type ScreenShareEvent<S, C> =
  | {
      readonly type: "phase";
      readonly phase: ScreenSharePhase;
      readonly previous: ScreenSharePhase;
    }
  /** A capture is live and published: a first start or a restart. */
  | {
      readonly type: "started";
      readonly share: LiveScreenShare<S, C>;
      readonly restarted: boolean;
    }
  /** The live share's audio or quality changed in place. */
  | { readonly type: "updated"; readonly share: LiveScreenShare<S, C> }
  /** A restart failed before it touched the live share, which is kept. */
  | {
      readonly type: "restart-failed";
      readonly share: LiveScreenShare<S, C>;
      readonly error: unknown;
    }
  /**
   * The share is withdrawn and released. `announced`: a `started` was
   * emitted for it (a share stopped before it went live was not).
   */
  | {
      readonly type: "ended";
      readonly reason: ScreenShareEndReason;
      readonly announced: boolean;
      readonly error?: unknown;
    };

export type ScreenShareListener<S, C> = (event: ScreenShareEvent<S, C>) => void;

export type ScreenShareStep =
  | "eligible"
  | "native-start"
  | "native-stop"
  | "native-quality"
  | "apply-quality"
  | "release"
  | "publish"
  | "listener";

export interface ScreenShareOptions<T, S, C extends ScreenCapture<T>> {
  /** The client's reconciler; the share owns its `screen` slot. */
  readonly publication: PublicationReconciler<T>;
  readonly sources: ScreenShareSources<S, C>;
  /** A step that failed without failing the share (logged by platforms). */
  readonly onError?: (step: ScreenShareStep, error: unknown) => void;
}

interface Wanted<S> {
  readonly request: ScreenShareRequest<S>;
  /** Moves on every `start()`: a new token is a new capture. */
  readonly token: number;
}

interface Live<S, C> {
  readonly request: ScreenShareRequest<S>;
  readonly token: number;
  readonly capture: C;
  /** Its local tracks were released (and a native pipeline stopped). */
  released: boolean;
}

type Step = () => Promise<void>;

/**
 * Only quality differs, on the same picked source: a native share may
 * switch it in place.
 */
function onlyQualityDiffers<S>(
  next: ScreenShareRequest<S>,
  live: ScreenShareRequest<S>,
): boolean {
  return (
    next.sourceKey !== null &&
    next.sourceKey === live.sourceKey &&
    next.audio === live.audio &&
    next.preferNative === live.preferNative &&
    next.quality !== live.quality
  );
}

/**
 * Owns one client's screen share. Commands (`start`, `stop`, `setAudio`,
 * `setQuality`, `captureEnded`) only change what is wanted; one driver
 * applies the latest wish, one step at a time, so restarts never overlap
 * and rapid commands collapse into the last one. Create one per client and
 * dispose it in the session's teardown.
 */
export class ScreenShare<T, S, C extends ScreenCapture<T>> {
  private readonly publication: PublicationReconciler<T>;
  private readonly sources: ScreenShareSources<S, C>;
  private readonly onError: ScreenShareOptions<T, S, C>["onError"];
  private readonly listeners = new Set<ScreenShareListener<S, C>>();
  private currentPhase: ScreenSharePhase = "off";
  private wish: Wanted<S> | null = null;
  private current: Live<S, C> | null = null;
  private announced = false;
  private endReason: ScreenShareEndReason = "stopped";
  private endedCapture: C | null = null;
  private tokens = 0;
  private driving = false;
  private disposed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(options: ScreenShareOptions<T, S, C>) {
    this.publication = options.publication;
    this.sources = options.sources;
    this.onError = options.onError;
  }

  get phase(): ScreenSharePhase {
    return this.currentPhase;
  }

  /** The share wanted now (latest command), or null: none. */
  get wanted(): ScreenShareRequest<S> | null {
    return this.wish?.request ?? null;
  }

  /** The share peers see (or last saw, during a restart), if any. */
  get live(): LiveScreenShare<S, C> | null {
    return this.current ? this.describe(this.current) : null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  subscribe(listener: ScreenShareListener<S, C>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Shares `request`: a first start, or (while sharing) a restart on it. A
   * restart on the same native source that only changes quality is a
   * quality change in place.
   */
  start(request: ScreenShareRequest<S>): void {
    if (this.disposed) return;
    this.tokens += 1;
    this.wish = { request, token: this.tokens };
    this.endReason = "stopped";
    this.kick();
  }

  /** Stops sharing (after the step in flight, if any, lands). */
  stop(): void {
    if (this.disposed || !this.wish) return;
    this.wish = null;
    this.endReason = "stopped";
    this.kick();
  }

  /**
   * Turns the share's audio on or off. Browser path: in place (the audio
   * track's `enabled`). Native path: a restart with the flag flipped, since
   * the pipeline's loopback is fixed when it starts. Ignored when off.
   */
  setAudio(audio: boolean): void {
    const wish = this.wish;
    if (this.disposed || !wish || wish.request.audio === audio) return;
    this.wish = { ...wish, request: { ...wish.request, audio } };
    this.kick();
  }

  /** Flips the wanted audio (the latest wish wins). */
  toggleAudio(): void {
    if (this.wish) this.setAudio(!this.wish.request.audio);
  }

  /**
   * Changes quality. Browser path: in place. Native path: in place if the
   * pipeline can, else a restart. Ignored when off.
   */
  setQuality(quality: string): void {
    const wish = this.wish;
    if (this.disposed || !wish || wish.request.quality === quality) return;
    this.wish = { ...wish, request: { ...wish.request, quality } };
    this.kick();
  }

  /**
   * `capture` stopped producing video by itself. Ends the share if it is
   * the live capture and nothing newer is wanted; ignored otherwise. A
   * newer `start` queued meanwhile still runs (it replaces the dead
   * capture), and a restart in flight decides on its own (it replaces the
   * capture, or finds it dead and ends the share).
   */
  captureEnded(capture: C): void {
    if (this.disposed) return;
    this.endedCapture = capture;
    this.kick();
  }

  /** Resolves once nothing is in flight. */
  idle(): Promise<void> {
    if (!this.driving) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * The session ended: releases every local capture, now and whatever is
   * still in flight when it lands. Withdraws nothing and stops no native
   * pipeline (the client's disconnect disposes the media session and the
   * native transport). Emits nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    const live = this.current;
    this.current = null;
    this.wish = null;
    this.endedCapture = null;
    this.announced = false;
    if (live && !live.released) {
      live.released = true;
      this.releaseLocal(live.capture);
    }
    this.currentPhase = "off";
    this.settleIdle();
  }

  private kick(): void {
    if (this.driving) {
      if (!this.wish) this.setPhase("stopping");
      return;
    }
    void this.drive();
  }

  private async drive(): Promise<void> {
    this.driving = true;
    try {
      for (;;) {
        if (this.disposed) return;
        const step = this.nextStep();
        if (!step) break;
        await step();
      }
      this.setPhase(this.current ? "live" : "off");
    } finally {
      this.driving = false;
      this.settleIdle();
    }
  }

  private nextStep(): Step | null {
    const live = this.current;
    if (live && this.endedCapture === live.capture) {
      this.endedCapture = null;
      // Only the wish for the capture that ended goes: a newer start
      // queued meanwhile replaces it.
      if (this.wish?.token === live.token) {
        this.wish = null;
        this.endReason = "source-ended";
      }
    }
    const wish = this.wish;
    if (!wish) return live ? () => this.end(this.endReason) : null;
    if (!live) return () => this.startShare(wish, null);
    if (live.token !== wish.token) return () => this.replaceShare(wish, live);
    if (wish.request.audio !== live.request.audio) {
      return () => this.changeAudio(wish, live);
    }
    if (wish.request.quality !== live.request.quality) {
      return () => this.changeQuality(wish, live);
    }
    return null;
  }

  /** A new capture for `target`; `previous` is the announced share, if any. */
  private async startShare(
    target: Wanted<S>,
    previous: Live<S, C> | null,
  ): Promise<void> {
    this.setPhase(previous ? "restarting" : "starting");
    const { request } = target;
    const native = this.sources.native;
    const useNative =
      request.preferNative &&
      native !== null &&
      (await this.attempt("eligible", () => native.eligible(request), false));
    if (this.disposed) return;
    if (useNative && previous?.capture.path === "browser") {
      // The native pipeline publishes the share's track names itself: the
      // browser publication on them is withdrawn first (web: StopTracks for
      // both names, the video parked on its keepalive), then its capture
      // is released, so one publisher holds the names at a time.
      if (!(await this.withdraw())) return;
      if (!previous.released) await this.releaseCapture(previous);
      if (this.disposed) return;
    } else if (
      previous &&
      !previous.released &&
      this.sources.releaseBeforeRestart(request)
    ) {
      await this.releaseCapture(previous);
      if (this.disposed) return;
    }
    // Stopped, or replaced by a newer start, while probing or releasing:
    // nothing is captured for this request (the driver goes on).
    if (!this.wish || this.wish.token !== target.token) return;

    let capture: C;
    try {
      capture = await this.capture(request, useNative);
    } catch (error) {
      await this.captureFailed(target, previous, error);
      return;
    }
    if (this.disposed) {
      this.releaseLocal(capture);
      return;
    }
    if (this.wish?.token !== target.token) {
      if (capture.path === "browser") {
        // Stopped, or replaced by a newer start, while capturing: released,
        // never published (the driver goes on with what is wanted now).
        this.releaseLocal(capture);
        return;
      }
      if (this.wish) {
        // A native capture a newer start replaced: its pipeline is stopped
        // (it withdraws what it pushed) and the newer start runs.
        await this.stopNativeCapture(capture);
        return;
      }
      // A native capture stopped while starting is on the wire already: it
      // is recorded below and ended like a live share.
    }
    // The old share goes once the new one is ready (a swap restart).
    if (previous && !previous.released) await this.releaseCapture(previous);
    if (this.disposed) {
      this.releaseLocal(capture);
      return;
    }

    let carriesAudio = request.audio;
    if (capture.path === "native") {
      // Already on the wire: recorded, so withdrawing it is an unpublish.
      const share: ScreenPublication<T> = { kind: "native" };
      this.publication.setTrack("screen", share);
      this.publication.adopt("screen", share, request.audio);
      this.publication.setEnabled("screen", request.audio);
    } else {
      carriesAudio = capture.audio !== null;
      const published = await this.publishCapture(capture, carriesAudio);
      if (this.disposed) {
        this.releaseLocal(capture);
        return;
      }
      if (published !== true) {
        this.current = {
          request,
          token: target.token,
          capture,
          released: false,
        };
        if (this.wish?.token === target.token) this.wish = null;
        await this.end("failed", published.error);
        return;
      }
      await this.attempt(
        "apply-quality",
        () => this.sources.browser.applyQuality(capture, request.quality),
        undefined,
      );
      if (this.disposed) {
        this.releaseLocal(capture);
        return;
      }
    }

    const applied: ScreenShareRequest<S> = { ...request, audio: carriesAudio };
    // What the capture carries is the share's audio, unless the user
    // changed it while it was being captured.
    const wish = this.wish;
    if (
      wish &&
      wish.token === target.token &&
      wish.request.audio === request.audio
    ) {
      this.wish = {
        ...wish,
        request: { ...wish.request, audio: carriesAudio },
      };
    }
    this.current = {
      request: applied,
      token: target.token,
      capture,
      released: false,
    };
    if (this.wish) {
      this.announced = true;
      this.emit({
        type: "started",
        share: this.describe(this.current),
        restarted: previous !== null,
      });
    }
  }

  /** The native pipeline if it may and can, else (or on failure) the browser. */
  private async capture(
    request: ScreenShareRequest<S>,
    useNative: boolean,
  ): Promise<C> {
    const native = this.sources.native;
    if (useNative && native) {
      let started: C | null = null;
      try {
        started = await native.start(request);
      } catch (error) {
        await this.attempt("native-stop", () => native.stop(), undefined);
        if (this.disposed || !this.wish || !native.fallbackAllowed()) {
          throw error;
        }
        this.onError?.("native-start", error);
      }
      if (started) {
        if (!native.isActive()) {
          // Not a fallback case: the pipeline answered and then went away.
          // Stop it anyway, so nothing it kept (web: the transport's options,
          // which a voice reconnect would start again) outlives the failure.
          await this.attempt("native-stop", () => native.stop(), undefined);
          this.releaseLocal(started);
          throw new Error(
            "The native screen share was inactive after it started",
          );
        }
        return started;
      }
    }
    return this.sources.browser.capture(request);
  }

  private async captureFailed(
    target: Wanted<S>,
    previous: Live<S, C> | null,
    error: unknown,
  ): Promise<void> {
    if (this.disposed) return;
    if (
      previous &&
      !previous.released &&
      this.sources.isLive(previous.capture)
    ) {
      // A swap restart failed before touching the live share: keep it.
      if (this.wish?.token === target.token) {
        this.wish = { request: previous.request, token: previous.token };
      }
      this.emit({
        type: "restart-failed",
        share: this.describe(previous),
        error,
      });
      return;
    }
    // Stopped meanwhile, or a newer start is wanted: the driver goes on.
    if (!this.wish || this.wish.token !== target.token) return;
    this.wish = null;
    await this.end("failed", error);
  }

  /**
   * Publishes a browser capture on the `screen` slot. True once the slot
   * holds it; else the error (the run failed, or it was superseded).
   */
  private async publishCapture(
    capture: C,
    audio: boolean,
  ): Promise<true | { error: unknown }> {
    if (!capture.video) {
      return { error: new Error("The screen capture has no video track") };
    }
    const share: ScreenPublication<T> = {
      kind: "tracks",
      video: capture.video,
      audio: capture.audio,
    };
    this.publication.setTrack("screen", share);
    this.publication.setEnabled("screen", audio);
    const result = await this.publication.reconcile();
    if (result.status === "disposed") {
      this.dispose();
      return { error: new Error("The publication ended with the session") };
    }
    if (this.publication.appliedFor("screen")?.track === share) return true;
    return {
      error:
        result.status === "failed"
          ? result.error
          : new Error("The screen publication did not converge"),
    };
  }

  private async replaceShare(
    target: Wanted<S>,
    live: Live<S, C>,
  ): Promise<void> {
    const native = this.sources.native;
    if (
      live.capture.path === "native" &&
      native &&
      onlyQualityDiffers(target.request, live.request)
    ) {
      const switched = await this.attempt(
        "native-quality",
        () => native.updateQuality(target.request.quality),
        false,
      );
      if (this.disposed) return;
      if (switched) {
        this.current = {
          ...live,
          request: { ...target.request },
          token: target.token,
        };
        this.emit({ type: "updated", share: this.describe(this.current) });
        return;
      }
    }
    await this.startShare(target, live);
  }

  private async changeAudio(
    target: Wanted<S>,
    live: Live<S, C>,
  ): Promise<void> {
    const audio = target.request.audio;
    if (live.capture.path === "browser") {
      this.publication.setEnabled("screen", audio);
      this.current = { ...live, request: { ...live.request, audio } };
      this.emit({ type: "updated", share: this.describe(this.current) });
      return;
    }
    // Native loopback audio is fixed when the pipeline starts.
    await this.startShare(target, live);
  }

  private async changeQuality(
    target: Wanted<S>,
    live: Live<S, C>,
  ): Promise<void> {
    const quality = target.request.quality;
    const native = this.sources.native;
    if (live.capture.path === "browser") {
      await this.attempt(
        "apply-quality",
        () => this.sources.browser.applyQuality(live.capture, quality),
        undefined,
      );
    } else {
      const switched =
        native !== null &&
        (await this.attempt(
          "native-quality",
          () => native.updateQuality(quality),
          false,
        ));
      if (this.disposed) return;
      if (!switched) {
        await this.startShare(target, live);
        return;
      }
    }
    if (this.disposed || this.current !== live) return;
    this.current = { ...live, request: { ...live.request, quality } };
    this.emit({ type: "updated", share: this.describe(this.current) });
  }

  /**
   * Withdraws and releases the announced share: a native pipeline is
   * stopped first, then the `screen` slot is unpublished (web: StopTracks
   * for both track names), then local tracks are released.
   */
  private async end(
    reason: ScreenShareEndReason,
    error?: unknown,
  ): Promise<void> {
    this.setPhase("stopping");
    const live = this.current;
    if (live && !live.released && live.capture.path === "native") {
      await this.releaseCapture(live);
      if (this.disposed) return;
    }
    if (!(await this.withdraw())) return;
    if (live && !live.released) await this.releaseCapture(live);
    if (this.disposed) return;
    this.current = null;
    this.endedCapture = null;
    const announced = this.announced;
    this.announced = false;
    this.emit(
      error === undefined
        ? { type: "ended", reason, announced }
        : { type: "ended", reason, announced, error },
    );
  }

  /**
   * Withdraws the `screen` slot: its intent becomes nothing and the module
   * awaits `reconcile()`. False: the module was disposed meanwhile.
   */
  private async withdraw(): Promise<boolean> {
    this.publication.setTrack("screen", null);
    const result = await this.publication.reconcile();
    if (this.disposed) return false;
    if (result.status === "disposed") {
      this.dispose();
      return false;
    }
    if (result.status === "failed" && result.failedSlots.includes("screen")) {
      this.onError?.("publish", result.error);
    }
    return true;
  }

  /** Stops a native capture that never became the live share. */
  private async stopNativeCapture(capture: C): Promise<void> {
    const native = this.sources.native;
    if (native) {
      await this.attempt("native-stop", () => native.stop(), undefined);
    }
    this.releaseLocal(capture);
  }

  /** Stops a native pipeline (for a native capture) and the local tracks. */
  private async releaseCapture(live: Live<S, C>): Promise<void> {
    if (live.released) return;
    live.released = true;
    const native = this.sources.native;
    if (live.capture.path === "native" && native) {
      await this.attempt("native-stop", () => native.stop(), undefined);
    }
    this.releaseLocal(live.capture);
  }

  private releaseLocal(capture: C): void {
    try {
      this.sources.release(capture);
    } catch (error) {
      this.onError?.("release", error);
    }
  }

  private async attempt<R>(
    step: ScreenShareStep,
    run: () => Promise<R> | R,
    fallback: R,
  ): Promise<R> {
    try {
      return await run();
    } catch (error) {
      this.onError?.(step, error);
      return fallback;
    }
  }

  private describe(live: Live<S, C>): LiveScreenShare<S, C> {
    return {
      request: live.request,
      capture: live.capture,
      path: live.capture.path,
    };
  }

  private setPhase(phase: ScreenSharePhase): void {
    if (this.disposed || phase === this.currentPhase) return;
    const previous = this.currentPhase;
    this.currentPhase = phase;
    this.emit({ type: "phase", phase, previous });
  }

  private emit(event: ScreenShareEvent<S, C>): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.onError?.("listener", error);
      }
    }
  }

  private settleIdle(): void {
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

export interface ScreenSubscriptionInput {
  /** The viewer pressed Watch on this share. */
  readonly watched: boolean;
  /** The share's tile is on stage. */
  readonly shareFocused: boolean;
  /** Any tile of this participant (share or camera) is on stage. */
  readonly participantFocused: boolean;
  /** The viewer set "always hear" for this participant's share audio. */
  readonly alwaysHear: boolean;
}

export interface ScreenSubscription {
  /** Pull `screen-video-<id>`. Once pulled it stays pulled until it ends. */
  readonly video: boolean;
  /** Pull `screen-audio-<id>`: always (it costs a few kbps). */
  readonly audio: true;
  /** Play the share's audio (else its volume is 0). */
  readonly audible: boolean;
}

/**
 * What a viewer pulls of a remote share. Video only while watched or on
 * stage (the same rule its tile uses to show video instead of the Watch
 * prompt); audio always, audible only when on stage or "always hear".
 */
export function screenShareSubscription(
  input: ScreenSubscriptionInput,
): ScreenSubscription {
  return {
    video: input.watched || input.shareFocused,
    audio: true,
    audible: input.shareFocused || input.participantFocused || input.alwaysHear,
  };
}
