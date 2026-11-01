import * as ExpoCrypto from "expo-crypto";
import { RTCPeerConnection, registerGlobals } from "react-native-webrtc";

// What PartyTracks (partytracks/client, the PartyTracks class only) needs from
// the browser, on React Native. Import this module before partytracks.
//
// - RTCPeerConnection, RTCSessionDescription, MediaStream, getUserMedia:
//   react-native-webrtc's registerGlobals().
// - EventTarget, Event, CustomEvent (PartyTracks' History extends EventTarget
//   at module load and dispatches CustomEvent): React Native 0.88 installs
//   these itself (src/private/setup/setUpDOM.js).
// - crypto.randomUUID (push names each transceiver with one): Hermes has no
//   Web Crypto; expo-crypto's is backed by the platform's secure RNG.
// - RTCPeerConnection#currentLocalDescription (a pull that needs immediate
//   renegotiation sends it as its answer): react-native-webrtc only has
//   localDescription. Right after setLocalDescription(answer), which is when
//   PartyTracks reads it, the two are the same description.
// - RTCPeerConnection#close() setting the states to "closed" at once, as the
//   spec (and every browser) does: react-native-webrtc leaves connectionState
//   at "connected" until a native event arrives. PartyTracks closes a pushed
//   track's transceiver from a queued task that bails when the connection is
//   "closed"; without this, leaving a call ran that task's createOffer() on
//   the closed connection and it threw "CreateOffer called when
//   PeerConnection is closed" (seen on the emulator).
//
// Not shimmed, and why that is safe:
// - RTCRtpSender#transport is undefined here (null in browsers before
//   negotiation), so PartyTracks calls sender.replaceTrack() with the track the
//   transceiver already has on the first emission too. That is a no-op swap.
// - window.setTimeout: React Native defines `window` as the global object.
// - PartyTracks' DOM-only exports (getMic, getCamera, devices$, createAudioSink,
//   screenshare$, the localStorage probe in a try/catch) are never called.
//   devices$ and the track Observables are lazy, so importing them runs
//   nothing.

registerGlobals();

const runtime = globalThis as { crypto?: { randomUUID?: () => string } };
runtime.crypto ??= {};
if (typeof runtime.crypto.randomUUID !== "function") {
  runtime.crypto.randomUUID = () => ExpoCrypto.randomUUID();
}

if (!("currentLocalDescription" in RTCPeerConnection.prototype)) {
  Object.defineProperty(
    RTCPeerConnection.prototype,
    "currentLocalDescription",
    {
      configurable: true,
      get(this: RTCPeerConnection) {
        return this.localDescription;
      },
    },
  );
}

const nativeClose = RTCPeerConnection.prototype.close;
RTCPeerConnection.prototype.close = function close(this: RTCPeerConnection) {
  nativeClose.call(this);
  this.connectionState = "closed";
  this.iceConnectionState = "closed";
  this.signalingState = "closed";
};
