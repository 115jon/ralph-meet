import { router } from "expo-router";

import { eventDecoder } from "@/features/realtime/event-decoder";
import {
  onDispatch,
  sendCallEnd,
  sendCallInitiate,
} from "@/features/realtime/gateway";
import { joinVoiceChannel, leaveCall } from "@/features/voice/actions";
import { useVoiceStore } from "@/features/voice/store";
import { tapHaptic } from "@/lib/haptics";
import { showToast } from "@/ui";

import * as RalphCall from "../../../modules/ralph-call/src";
import { answerCall } from "./api";
import { unreachableText } from "./record";
import {
  CallRingEventSchema,
  CallRingingEventSchema,
  CallRingStopEventSchema,
  type CallRingStopEvent,
} from "./schema";
import { type CallPeer, type IncomingRing, useCallsStore } from "./store";

// DM calls, as the web runs them (stores/chat-gateway.ts, DMCallRegion):
// the caller sends CallInitiate and the server puts them in the DM's voice
// channel while it rings; the callee answers by joining that channel. On
// Android the ring itself (ringtone, lock screen, notification, Telecom) is
// modules/ralph-call's, whether it came over the gateway or as a push; this
// module keeps the app's side: our outgoing ring, the in-app sheet, and
// joining the call once answered.

const { getState, setState } = useCallsStore;

/** The server rings for 30 s (meeting-room.ts CALL_RING_TIMEOUT_MS). */
const RING_SECONDS = 30;

/**
 * A ring we cancelled before the server said it was ringing: when its
 * CALL_RINGING arrives, it is cancelled with the id it brings.
 */
let cancelledBeforeRinging: string | null = null;

function inCallIn(channelId: string): boolean {
  return useVoiceStore.getState().call?.channelId === channelId;
}

function joinDmCall(
  channelId: string,
  peer: CallPeer,
  answeredCallId?: string,
): void {
  void joinVoiceChannel({
    serverId: "",
    channelId,
    channelName: peer.name,
    dm: { peerId: peer.id, answeredCallId },
  });
}

// ── Outgoing ──────────────────────────────────────────────────────────────

/** Rings `peer` in the DM `channelId`. */
export function startDmCall(channelId: string, peer: CallPeer): void {
  const current = getState().outgoing;
  if (current && current.channelId !== channelId) hangUp(current.channelId);
  if (getState().outgoing) return;
  if (!sendCallInitiate(peer.id, channelId)) {
    showToast({
      label: peer.name,
      text: "You're offline. Try again in a moment.",
      led: "danger",
    });
    return;
  }
  tapHaptic();
  cancelledBeforeRinging = null;
  setState({
    outgoing: {
      channelId,
      peer,
      callId: null,
      phase: "starting",
      since: Date.now(),
    },
  });
}

/** After "No answer" or a decline: ring them again from the call. */
export function ringAgain(channelId: string): void {
  const outgoing = getState().outgoing;
  if (outgoing?.channelId !== channelId) return;
  setState({ outgoing: null });
  startDmCall(channelId, outgoing.peer);
}

/** The DM call's end key: cancels our ring and leaves the call. */
export function hangUp(channelId: string): void {
  const outgoing = getState().outgoing;
  if (outgoing?.channelId === channelId) {
    if (outgoing.phase === "ringing" && outgoing.callId) {
      sendCallEnd(outgoing.callId);
    } else if (outgoing.phase === "starting") {
      cancelledBeforeRinging = channelId;
    }
    setState({ outgoing: null });
    void RalphCall.setRingback(false);
  }
  if (inCallIn(channelId)) leaveCall();
}

function onRinging(callId: string, channelId: string): void {
  if (cancelledBeforeRinging === channelId) {
    cancelledBeforeRinging = null;
    sendCallEnd(callId);
    return;
  }
  const outgoing = getState().outgoing;
  // A ring started on another device of ours (the web) is that device's.
  if (outgoing?.channelId !== channelId) return;
  setState({
    outgoing: { ...outgoing, callId, phase: "ringing", since: Date.now() },
  });
  void RalphCall.setRingback(true);
  // The server has put us in the DM's voice channel: connect to its room,
  // so we are there the moment they answer.
  if (!inCallIn(channelId)) joinDmCall(channelId, outgoing.peer);
}

function onOutgoingStop({ call_id, reason }: CallRingStopEvent): void {
  const outgoing = getState().outgoing;
  if (!outgoing) return;
  const ours =
    call_id === null
      ? outgoing.phase === "starting"
      : call_id === outgoing.callId;
  if (!ours) return;
  void RalphCall.setRingback(false);
  if (reason === "accepted") {
    // From here it is a voice call; the region shows them connected.
    setState({ outgoing: null });
    tapHaptic();
    return;
  }
  if (reason === "timeout" || reason === "declined") {
    // We stay in the call (the server's lobby), as on the web.
    setState({
      outgoing: {
        ...outgoing,
        phase: reason === "timeout" ? "no-answer" : "declined",
      },
    });
    return;
  }
  const text = unreachableText(reason, outgoing.peer.name);
  if (text) showToast({ label: outgoing.peer.name, text, led: "danger" });
  if (text && inCallIn(outgoing.channelId)) {
    // Ring again from the lobby found them busy: the lobby stays.
    setState({ outgoing: { ...outgoing, phase: "no-answer" } });
    return;
  }
  setState({ outgoing: null });
  if (!text && inCallIn(outgoing.channelId)) leaveCall();
}

// ── Incoming ──────────────────────────────────────────────────────────────

/** A ring for this phone, from the gateway (pushes go straight to native). */
function onRing(ring: IncomingRing): void {
  if (RalphCall.isAvailable) {
    // The module rings once per call id, whichever of push and gateway is
    // first, and calls back with onIncomingCall while the app is in front.
    void RalphCall.ringIncoming({
      callId: ring.callId,
      channelId: ring.channelId,
      callerId: ring.caller.id,
      callerName: ring.caller.name,
      callerAvatar: ring.caller.avatarUrl,
      ringSeconds: RING_SECONDS,
    });
    return;
  }
  setState({ incoming: ring });
}

function onIncomingStop({ call_id, reason }: CallRingStopEvent): void {
  if (!call_id) return;
  if (RalphCall.isAvailable) void RalphCall.stopIncoming(call_id, reason);
  endIncoming(call_id);
}

/** The module is showing `call` to the app (onIncomingCall). */
export function showIncoming(call: RalphCall.IncomingCall): void {
  setState({
    incoming: {
      callId: call.callId,
      channelId: call.channelId,
      caller: {
        id: call.callerId,
        name: call.callerName,
        avatarUrl: call.callerAvatar,
      },
    },
  });
}

/** The ring stopped (answered, declined, missed, cancelled). */
export function endIncoming(callId: string): void {
  if (getState().incoming?.callId === callId) setState({ incoming: null });
}

/**
 * Joins the answered call and opens it. Answering goes over REST too, so it
 * also counts with the gateway still connecting (a cold start); joining the
 * channel would accept it anyway. A call that stopped ringing meanwhile is
 * left again.
 */
async function joinAnswered(ring: IncomingRing): Promise<void> {
  const call = useVoiceStore.getState().call;
  if (call?.dm?.answeredCallId !== ring.callId) {
    joinDmCall(ring.channelId, ring.caller, ring.callId);
  }
  if (router.canDismiss()) router.dismissTo("/home");
  router.push("/call");
  const result = await answerCall(ring.callId, "accept");
  if (result !== "gone") return;
  if (useVoiceStore.getState().call?.dm?.answeredCallId === ring.callId) {
    leaveCall();
  }
  showToast({
    label: ring.caller.name,
    text: "The call ended before you answered",
    led: "danger",
  });
}

/** Answer in the app's sheet. */
export function answerRing(ring: IncomingRing): void {
  setState({ incoming: null });
  void RalphCall.answerIncoming(ring.callId);
  void joinAnswered(ring);
}

/** Decline in the app's sheet (Back and swipe-down too). */
export function declineRing(ring: IncomingRing): void {
  setState({ incoming: null });
  if (RalphCall.isAvailable) {
    // The module stops the ring and tells the server, like its own Decline.
    void RalphCall.declineIncoming(ring.callId);
  } else {
    void answerCall(ring.callId, "decline");
  }
}

/**
 * A call answered from the notification, the lock screen or a headset,
 * possibly before JS was running: join it.
 */
export async function takeNativeAnswer(): Promise<void> {
  const call = await RalphCall.takeAnsweredCall();
  if (!call) return;
  setState({ incoming: null });
  await joinAnswered({
    callId: call.callId,
    channelId: call.channelId,
    caller: {
      id: call.callerId,
      name: call.callerName,
      avatarUrl: call.callerAvatar,
    },
  });
}

/** A missed call's "Call back": the DM's page asks before ringing. */
export function requestCallBack(channelId: string): void {
  setState({ callBack: channelId });
}

export function takeCallBack(channelId: string): boolean {
  if (getState().callBack !== channelId) return false;
  setState({ callBack: null });
  return true;
}

// ── Gateway events ────────────────────────────────────────────────────────

const decodeRing = eventDecoder(CallRingEventSchema);
const decodeRinging = eventDecoder(CallRingingEventSchema);
const decodeStop = eventDecoder(CallRingStopEventSchema);

function handle(event: string, data: unknown): void {
  switch (event) {
    case "CALL_RING": {
      const d = decodeRing(data);
      if (!d) return;
      onRing({
        callId: d.call_id,
        channelId: d.channel_id,
        caller: {
          id: d.caller_id,
          name:
            d.caller_display_name ??
            d.caller_username ??
            d.caller_name ??
            "Someone",
          avatarUrl: d.caller_avatar ?? null,
        },
      });
      return;
    }
    case "CALL_RINGING": {
      const d = decodeRinging(data);
      if (d) onRinging(d.call_id, d.channel_id);
      return;
    }
    case "CALL_RING_STOP": {
      const d = decodeStop(data);
      if (!d) return;
      onIncomingStop(d);
      onOutgoingStop(d);
      return;
    }
    default:
      return;
  }
}

/** Notes when the other person is in the DM call with us, and when they left. */
function watchConnection(): () => void {
  return useVoiceStore.subscribe(({ call }) => {
    const peerId = call?.dm?.peerId;
    const here =
      peerId !== undefined &&
      Object.values(call?.participants ?? {}).some((p) => p.userId === peerId);
    const connectedAt = getState().connectedAt;
    if (here && connectedAt === null) setState({ connectedAt: Date.now() });
    if (!here && connectedAt !== null) setState({ connectedAt: null });
  });
}

/** DM call events from the gateway; returns the unsubscribe. */
export function startCallEvents(): () => void {
  const offDispatch = onDispatch(handle);
  const offConnection = watchConnection();
  return () => {
    offDispatch();
    offConnection();
  };
}
