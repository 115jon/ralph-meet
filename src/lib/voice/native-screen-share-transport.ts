import { clog } from "@/lib/console-logger";
import {
  type IceServer,
  type NegotiationDonePayload,
  type SessionDescriptionPayload,
} from "@/lib/types";
import { GatewayOp } from "@/lib/gateway-protocol";
import type { VoiceGateway } from "@/lib/voice/gateways/voice-gateway";

const nativeScreenLog = clog("NativeScreenShare");

export interface NativeScreenShareOptions {
  sourceId: string;
  sourceName?: string | null;
  quality: string;
  withAudio: boolean;
}

export type NativeScreenShareInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface NativeScreenShareTransportOptions {
  gateway: VoiceGateway;
  getIceServers(): IceServer[];
  getParticipantId(): string | null;
  invoke?: NativeScreenShareInvoke;
  isVoiceReady(): boolean;
  waitForVoiceReady(): Promise<void>;
}

interface Deferred {
  promise: Promise<void>;
  reject(reason: unknown): void;
  resolve(): void;
}

interface PendingNegotiation {
  answer: Deferred;
  generation: number;
  negotiationDone: Deferred;
  requestId: string;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  promise.catch(() => undefined);
  return { promise, reject, resolve };
}

function isNativeOffer(
  value: unknown,
): value is { sdp: string; type: "offer" } {
  if (!value || typeof value !== "object") return false;
  const offer = value as Record<string, unknown>;
  return offer.type === "offer" && typeof offer.sdp === "string";
}

async function defaultInvoke(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
}

/**
 * Owns the temporary legacy signaling required by Ralph's native Rust screen
 * publisher. Browser media never crosses this seam.
 */
export class NativeScreenShareTransport {
  private activeState = false;
  private disposed = false;
  private generation = 0;
  private nativeLifecycleQueue: Promise<void> = Promise.resolve();
  private options: NativeScreenShareOptions | null = null;
  private pendingState = false;
  private pendingNegotiation: PendingNegotiation | null = null;
  private previewLoopbackPC: RTCPeerConnection | null = null;
  private previewLoopbackStream: MediaStream | null = null;
  private previewLoopbackUnlisten: (() => void) | null = null;
  private requestSequence = 0;
  private tracksOffered = false;
  private trackNames: string[] = [];
  private readonly unsubscribeGatewayEvents: Array<() => void>;

  constructor(private readonly config: NativeScreenShareTransportOptions) {
    this.unsubscribeGatewayEvents = [
      this.config.gateway.on("session-description", (payload) => {
        void this.acceptAnswer(payload);
      }),
      this.config.gateway.on("negotiation-done", (payload) => {
        this.acceptNegotiationDone(payload);
      }),
      this.config.gateway.on("error", (payload) => {
        const pending = this.pendingNegotiation;
        if (
          !pending ||
          payload.operation !== "push" ||
          payload.push_prefix !== "screen" ||
          (payload.request_id && payload.request_id !== pending.requestId)
        ) {
          return;
        }
        this.cancelPending(new Error(payload.message));
      }),
    ];
  }

  get active(): boolean {
    return this.activeState || this.pendingState;
  }

  get previewStream(): MediaStream | null {
    return this.previewLoopbackStream;
  }

  async start(options: NativeScreenShareOptions): Promise<void> {
    this.assertUsable();
    const participantId = this.config.getParticipantId();
    if (!participantId) {
      throw new Error("Cannot start native screen share before joining voice");
    }
    if (this.active) {
      await this.stopOwnedCapture({
        clearOptions: true,
        reason: new Error("Native screen share replaced"),
      });
    }

    const generation = ++this.generation;
    this.activeState = false;
    this.pendingState = true;
    this.options = { ...options };
    const currentOptions = this.options;
    const videoTrackName = `screen-video-${participantId}`;
    const audioTrackName = `screen-audio-${participantId}`;
    const pushTracks = [
      { track_name: videoTrackName, mid: "0", kind: "video" as const },
      ...(options.withAudio
        ? [{ track_name: audioTrackName, mid: "1", kind: "audio" as const }]
        : []),
    ];
    this.trackNames = pushTracks.map((track) => track.track_name);
    this.tracksOffered = false;
    let nativeCaptureStarted = false;

    try {
      if (!this.config.isVoiceReady()) {
        await this.config.waitForVoiceReady();
        this.assertCurrent(generation);
      }

      const offer = await this.enqueueNativeLifecycle(() =>
        (this.config.invoke ?? defaultInvoke)("start_native_screen_share", {
          sourceId: options.sourceId,
          sourceName: options.sourceName ?? null,
          quality: options.quality,
          trackName: videoTrackName,
          audioTrackName,
          withAudio: options.withAudio,
          iceServers: this.config.getIceServers(),
        }),
      );
      nativeCaptureStarted = true;
      if (!isNativeOffer(offer)) {
        throw new Error("Native screen share returned an invalid SDP offer");
      }
      this.assertCurrent(generation);

      const requestId = this.nextRequestId();
      const pending: PendingNegotiation = {
        answer: createDeferred(),
        generation,
        negotiationDone: createDeferred(),
        requestId,
      };
      this.pendingNegotiation = pending;
      this.config.gateway.send({
        op: GatewayOp.SelectProtocol,
        d: {
          sdp: offer.sdp,
          push_tracks: pushTracks,
          pull_tracks: [],
          push_prefix: "screen",
          request_id: requestId,
        },
      });
      this.tracksOffered = true;

      await Promise.all([
        pending.answer.promise,
        pending.negotiationDone.promise,
      ]);
      this.assertCurrent(generation);
      await (this.config.invoke ?? defaultInvoke)(
        "wait_native_screen_share_connected",
        { timeoutMs: 10000 },
      );
      this.assertCurrent(generation);

      this.config.gateway.send({
        op: GatewayOp.TracksReady,
        d: { track_names: [...this.trackNames] },
      });
      this.pendingNegotiation = null;
      this.pendingState = false;
      this.activeState = true;
      nativeScreenLog.info("Native hardware screen share is connected", {
        tracks: this.trackNames,
        sourceId: currentOptions.sourceId,
        quality: currentOptions.quality,
      });
    } catch (error) {
      if (generation === this.generation) {
        if (nativeCaptureStarted) {
          await this.stopOwnedCapture({
            clearOptions: true,
            reason: error,
          });
        } else {
          this.pendingNegotiation = null;
          this.pendingState = false;
          this.activeState = false;
          this.options = null;
          this.tracksOffered = false;
          this.trackNames = [];
        }
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.assertUsable();
    await this.stopOwnedCapture({
      clearOptions: true,
      reason: new Error("Native screen share stopped"),
    });
  }

  async reconnect(): Promise<void> {
    this.assertUsable();
    const options = this.options;
    if (!options) return;
    await this.stopOwnedCapture({
      clearOptions: false,
      reason: new Error("Native screen share reconnecting"),
    });
    await this.start(options);
  }

  async reset(): Promise<void> {
    this.assertUsable();
    await this.stopOwnedCapture({
      clearOptions: false,
      reason: new Error("Native screen share reset"),
    });
  }

  async updateQuality(quality: string): Promise<boolean> {
    this.assertUsable();
    if (!this.active) return false;
    try {
      await (this.config.invoke ?? defaultInvoke)(
        "update_native_screen_quality",
        { quality },
      );
      if (this.options) this.options = { ...this.options, quality };
      nativeScreenLog.info("Native screen quality switched in place", {
        quality,
      });
      return true;
    } catch (error) {
      nativeScreenLog.warn(
        "In-place native quality switch failed; caller may restart",
        error,
      );
      return false;
    }
  }

  async startPreview(): Promise<MediaStream | null> {
    this.assertUsable();
    if (this.previewLoopbackPC) await this.stopPreview();

    try {
      const nativeOffer = await (this.config.invoke ?? defaultInvoke)(
        "start_preview_loopback",
      );
      if (!isNativeOffer(nativeOffer)) {
        throw new Error("Native preview returned an invalid SDP offer");
      }
      const pc = new RTCPeerConnection({ iceServers: [] });
      let stream: MediaStream | null = null;
      const trackPromise = new Promise<MediaStream>((resolve) => {
        pc.ontrack = (event) => {
          const nextStream = event.streams[0] ?? new MediaStream([event.track]);
          stream = nextStream;
          resolve(nextStream);
        };
      });

      await pc.setRemoteDescription({ type: "offer", sdp: nativeOffer.sdp });
      if (typeof RTCRtpSender.getCapabilities === "function") {
        const videoCapabilities = RTCRtpSender.getCapabilities("video");
        const h264Codecs =
          videoCapabilities?.codecs.filter(
            (codec) => codec.mimeType.toLowerCase() === "video/h264",
          ) ?? [];
        if (h264Codecs.length > 0) {
          for (const transceiver of pc.getTransceivers()) {
            transceiver.setCodecPreferences(h264Codecs);
          }
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const check = () => {
          if (pc.iceGatheringState !== "complete") return;
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        };
        pc.addEventListener("icegatheringstatechange", check);
        setTimeout(resolve, 500);
      });
      await (this.config.invoke ?? defaultInvoke)(
        "handle_preview_loopback_answer",
        { sdp: pc.localDescription?.sdp ?? answer.sdp },
      );

      const receivedTrack = await Promise.race([
        trackPromise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      if (!receivedTrack || !stream) {
        pc.close();
        return null;
      }

      for (const receiver of pc.getReceivers()) {
        if (receiver.jitterBufferTarget !== undefined) {
          receiver.jitterBufferTarget = 0;
          continue;
        }
        if ("playoutDelayHint" in receiver) {
          const receiverWithHint = receiver as RTCRtpReceiver & {
            playoutDelayHint?: number | null;
          };
          receiverWithHint.playoutDelayHint = 0;
        }
      }
      this.previewLoopbackPC = pc;
      this.previewLoopbackStream = stream;

      try {
        const { listen } = await import("@tauri-apps/api/event");
        this.previewLoopbackUnlisten = await listen<{
          candidate: RTCIceCandidateInit;
        }>("native-preview-ice-candidate", (event) => {
          const activePC = this.previewLoopbackPC;
          if (!activePC || !event.payload?.candidate) return;
          void activePC.addIceCandidate(event.payload.candidate);
        });
      } catch {
        // Inline localhost candidates normally complete preview setup.
      }
      nativeScreenLog.info("Preview loopback connected");
      return stream;
    } catch (error) {
      nativeScreenLog.warn("Failed to start preview loopback", error);
      return null;
    }
  }

  async stopPreview(): Promise<void> {
    this.previewLoopbackUnlisten?.();
    this.previewLoopbackUnlisten = null;
    this.previewLoopbackPC?.close();
    this.previewLoopbackPC = null;
    this.previewLoopbackStream = null;
    try {
      await (this.config.invoke ?? defaultInvoke)("stop_preview_loopback");
    } catch {
      // The Rust preview may already be gone during teardown.
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.stopOwnedCapture({
      clearOptions: true,
      reason: new Error("Native screen share transport disposed"),
    });
    for (const unsubscribe of this.unsubscribeGatewayEvents) unsubscribe();
  }

  private async acceptAnswer(
    payload: SessionDescriptionPayload,
  ): Promise<void> {
    const pending = this.pendingNegotiation;
    if (
      !pending ||
      payload.operation !== "push" ||
      payload.push_prefix !== "screen" ||
      payload.request_id !== pending.requestId ||
      pending.generation !== this.generation
    ) {
      return;
    }
    try {
      await (this.config.invoke ?? defaultInvoke)("handle_sdp_answer", {
        sdp: payload.sdp,
      });
      if (this.pendingNegotiation !== pending) return;
      pending.answer.resolve();
    } catch (error) {
      if (this.pendingNegotiation === pending) this.cancelPending(error);
    }
  }

  private acceptNegotiationDone(payload: NegotiationDonePayload): void {
    const pending = this.pendingNegotiation;
    if (
      !pending ||
      payload.operation !== "push" ||
      payload.push_prefix !== "screen" ||
      payload.request_id !== pending.requestId ||
      pending.generation !== this.generation
    ) {
      return;
    }
    pending.negotiationDone.resolve();
  }

  private async stopOwnedCapture({
    clearOptions,
    reason,
  }: {
    clearOptions: boolean;
    reason: unknown;
  }): Promise<void> {
    this.generation += 1;
    const wasOwned = this.activeState || this.pendingState;
    const wereTracksOffered = this.tracksOffered;
    const ownedTrackNames = [...this.trackNames];
    this.cancelPending(reason);
    this.activeState = false;
    this.pendingState = false;
    this.tracksOffered = false;
    this.trackNames = [];
    if (clearOptions) this.options = null;
    await this.stopPreview();
    if (!wasOwned) return;
    try {
      await this.enqueueNativeLifecycle(() =>
        (this.config.invoke ?? defaultInvoke)("stop_native_screen_share"),
      );
    } catch (error) {
      nativeScreenLog.warn("Failed to stop native screen share", error);
    }
    if (wereTracksOffered && ownedTrackNames.length > 0) {
      this.config.gateway.send({
        op: GatewayOp.StopTracks,
        d: { track_names: ownedTrackNames },
      });
    }
  }

  private cancelPending(reason: unknown): void {
    const pending = this.pendingNegotiation;
    if (!pending) return;
    this.pendingNegotiation = null;
    pending.answer.reject(reason);
    pending.negotiationDone.reject(reason);
  }

  private enqueueNativeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.nativeLifecycleQueue.then(operation);
    this.nativeLifecycleQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `push-screen-${Date.now()}-${this.requestSequence}`;
  }

  private assertCurrent(generation: number): void {
    this.assertUsable();
    if (generation !== this.generation) {
      throw new Error("Native screen share operation was superseded");
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("Native screen share transport is disposed");
    }
  }
}
