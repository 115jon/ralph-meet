import { clog, ScopedLogger } from "@/lib/console-logger";
import { VoiceOpcode } from "@/lib/types";
import type { VoiceGateway } from "./gateways/voice-gateway";
import type { TrackNegotiator } from "./track-negotiator";

export class WebRTCSessionManager {
  private readonly log: ScopedLogger;

  private pullRetryCount = 0;
  private pullResetCount = 0;
  private pushResetCount = 0;
  private pushResetLastTime = 0;

  /** Epoch counter — incremented on every resetPullSession. Pull operations
   *  capture the epoch when they start and self-abort if it changes during
   *  their execution, preventing stale pulls from corrupting the new session. */
  private pullEpoch = 0;

  // -- Disconnect grace timers (F2) --
  private static readonly DISCONNECT_GRACE_MS = 30_000;
  private pullDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private camPushDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private screenPushDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private negotiator: TrackNegotiator,
    private voiceGateway: VoiceGateway,
    private chatGatewayReconnectFn: () => void
  ) {
    this.log = clog("SFU:SessionMgr");
  }

  // ── WebRTC Teardown Guard ───────────────────────────────────────────

  public safelyClosePC(pc: RTCPeerConnection | null) {
    if (!pc) return;
    try {
      pc.getSenders().forEach((s) => {
        if (s.track) {
          s.track.onended = null;
          s.replaceTrack(null).catch(() => { });
          s.track.stop();
        }
        try { pc.removeTrack(s); } catch { }
      });
    } catch (e) {
      this.log.warn("Expected error while safely closing senders:", e);
    }
    try { pc.close(); } catch { }
  }

  public clearAllDisconnectTimers() {
    this.clearDisconnectTimer("pull");
    this.clearDisconnectTimer("camPush");
    this.clearDisconnectTimer("screenPush");
  }

  public clearDisconnectTimer(type: "pull" | "camPush" | "screenPush") {
    let timer = null;
    if (type === "pull") timer = this.pullDisconnectTimer;
    if (type === "camPush") timer = this.camPushDisconnectTimer;
    if (type === "screenPush") timer = this.screenPushDisconnectTimer;

    if (timer) {
      clearTimeout(timer);
      if (type === "pull") this.pullDisconnectTimer = null;
      if (type === "camPush") this.camPushDisconnectTimer = null;
      if (type === "screenPush") this.screenPushDisconnectTimer = null;
    }
  }

  public handleDisconnectGraceTimer(type: "pull" | "camPush" | "screenPush", isLeaving: boolean, resetFn: () => void) {
    if (isLeaving) return;
    this.clearDisconnectTimer(type);

    const timer = setTimeout(() => {
      this.log.error(`[F2] ${type} connection disconnected permanently — tearing down and requesting fresh tracks`);
      resetFn();
    }, WebRTCSessionManager.DISCONNECT_GRACE_MS);

    if (type === "pull") this.pullDisconnectTimer = timer;
    if (type === "camPush") this.camPushDisconnectTimer = timer;
    if (type === "screenPush") this.screenPushDisconnectTimer = timer;
  }

  public resetCircuitBreakers() {
    this.pullResetCount = 0;
    this.pushResetCount = 0;
    this.log.info("Circuit breakers reset");
  }

  // ── Circuit Breakers ────────────────────────────────────────────────

  public resetPullSession(isLeaving: boolean, forceSignalingReconnect: () => void) {
    if (isLeaving) return;
    this.pullResetCount++;
    if (this.pullResetCount > 3) {
      this.log.error("Pull circuit breaker tripped — will auto-reset in 30s");
      setTimeout(() => {
        this.pullResetCount = 0;
        this.log.info("Pull circuit breaker auto-reset");
      }, 30_000);
      return;
    }
    this.log.warn(`Resetting pull session and PeerConnection (attempt ${this.pullResetCount}/3)`);

    // If signaling is dead, force VoiceGW reconnect
    if (!this.voiceGateway.isReady) {
      this.log.warn("Signaling is dead during pull reset — forcing VoiceGW reconnect");
      forceSignalingReconnect();
    }

    this.safelyClosePC(this.negotiator.pullPC);
    this.pullEpoch++;
    this.pullRetryCount = 0;

    this.negotiator.resetPullSession();
    // In a real integration, the caller would call pullTracks() after returning.
  }

  public resetPushSession(isScreen: boolean, isLeaving: boolean, forceSignalingReconnect: () => void, triggerRepublish: () => void) {
    const now = Date.now();
    if (now - this.pushResetLastTime > 30_000) {
      this.pushResetCount = 0;
    }
    if (isLeaving) return;

    this.pushResetCount++;
    this.pushResetLastTime = now;
    if (this.pushResetCount > 3) {
      this.log.error("Push circuit breaker tripped — will auto-reset in 30s");
      setTimeout(() => {
        this.pushResetCount = 0;
        this.log.info("Push circuit breaker auto-reset");
      }, 30_000);
      return;
    }
    this.log.warn(`Resetting ${isScreen ? "screen" : "cam"} push PC (attempt ${this.pushResetCount}/3)`);

    if (!this.voiceGateway.isReady) {
      this.log.warn("Signaling is dead during push reset — forcing VoiceGW reconnect");
      forceSignalingReconnect();
    }

    // Stop tracks on server
    const trackPrefix = isScreen ? 'screen-' : 'cam-';
    const trackNames = [...this.negotiator.publishedTrackNames].filter(n => n.startsWith(trackPrefix));
    if (trackNames.length > 0) {
      for (const name of trackNames) {
        this.negotiator.teardownTransceiver(name);
      }
      this.voiceGateway.send({
        op: VoiceOpcode.StopTracks,
        d: { track_names: trackNames },
      });
    }

    // Close old PC
    const pc = isScreen ? this.negotiator.screenPushPC : this.negotiator.camPushPC;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      this.safelyClosePC(pc);
      if (isScreen) this.negotiator.screenPushPC = null;
      else this.negotiator.camPushPC = null;
    }

    this.negotiator.resetPushSession(isScreen ? 'screen' : 'cam');

    // Caller handles creating new PC and wiring handlers (triggerRepublish).
    triggerRepublish();
  }

  public getPullEpoch() {
    return this.pullEpoch;
  }

}
