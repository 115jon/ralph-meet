import { markVoice } from "@/lib/voice/latency-marks";

// ============================================================================
// Opus packet time for the outbound microphone.
//
// libwebrtc sizes Opus frames from the `ptime` the *remote* description asks
// for (an `a=ptime` line becomes the codec's "ptime" parameter, which the
// Opus encoder config reads). The SFU's SDP carries no ptime (fmtp
// `minptime=10;useinbandfec=1`), so Chrome sends 20 ms frames. Adding
// `a=ptime:10` to each remote description we apply makes it send 10 ms
// frames: ~10 ms less framing delay before the first packet of a word leaves,
// and finer packets for the receiver's jitter buffer. The fmtp line (in-band
// FEC, no DTX) is untouched. RTCRtpEncodingParameters.ptime is not shipped
// in Chrome, so SDP is the only lever.
//
// Cost: twice the packets (100/s instead of 50/s), ~+20-25 kbps of
// RTP/UDP/IP/SRTP overhead per sender at 32 kbps Opus, and slightly lower
// coding efficiency per bit. Set localStorage["ralph:voice-opus-ptime"] to
// "20" (or "off") to keep the browser default, e.g. for an A/B bench.
// ============================================================================

export const VOICE_OPUS_PTIME_MS = 10;
export const VOICE_OPUS_PTIME_OVERRIDE_KEY = "ralph:voice-opus-ptime";

/** The ptime to request, or null to leave the SDP alone. */
export function resolveVoiceOpusPtime(
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): number | null {
  let override: string | null = null;
  try {
    override = storage?.getItem(VOICE_OPUS_PTIME_OVERRIDE_KEY) ?? null;
  } catch {
    override = null;
  }
  if (override === null || override === "") return VOICE_OPUS_PTIME_MS;
  if (override === "off" || override === "20") return null;
  const parsed = Number(override);
  return [10, 20, 40, 60].includes(parsed) ? parsed : VOICE_OPUS_PTIME_MS;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Sets `a=ptime:<ptimeMs>` on every audio m-section that offers Opus,
 * replacing an existing ptime. Everything else is kept byte for byte.
 */
export function preferOpusPtime(sdp: string, ptimeMs: number): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const out: string[] = [];
  let section: string[] = [];

  const flush = () => {
    if (section.length === 0) return;
    out.push(...rewriteSection(section, ptimeMs));
    section = [];
  };
  for (const line of lines) {
    if (line.startsWith("m=")) flush();
    section.push(line);
  }
  flush();
  return out.join(eol);
}

function rewriteSection(section: string[], ptimeMs: number): string[] {
  if (!section[0]?.startsWith("m=audio")) return section;
  const opus = section
    .map((line) => /^a=rtpmap:(\d+) opus\//i.exec(line)?.[1])
    .find((pt) => pt !== undefined);
  if (opus === undefined) return section;

  const ptimeLine = `a=ptime:${ptimeMs}`;
  const existing = section.findIndex((line) => line.startsWith("a=ptime:"));
  if (existing !== -1) {
    const next = [...section];
    next[existing] = ptimeLine;
    return next;
  }
  // After Opus' fmtp (or rtpmap), before a trailing empty line.
  const anchor = section.findIndex((line) =>
    line.startsWith(`a=fmtp:${opus} `),
  );
  const rtpmap = section.findIndex((line) =>
    line.startsWith(`a=rtpmap:${opus} `),
  );
  const at = (anchor !== -1 ? anchor : rtpmap) + 1;
  return [...section.slice(0, at), ptimeLine, ...section.slice(at)];
}

const installed = new WeakSet<RTCPeerConnection>();

/**
 * Applies preferOpusPtime to every remote description (answers to our
 * pushes and the SFU's renegotiation offers alike, since either replaces the
 * send parameters) set on `peerConnection`.
 */
export function installOpusPtimePreference(
  peerConnection: RTCPeerConnection,
  ptimeMs: number,
): void {
  if (
    installed.has(peerConnection) ||
    typeof peerConnection.setRemoteDescription !== "function"
  )
    return;
  installed.add(peerConnection);
  const setRemoteDescription =
    peerConnection.setRemoteDescription.bind(peerConnection);
  peerConnection.setRemoteDescription = ((
    description: RTCSessionDescriptionInit,
  ) => {
    if (!description?.sdp) return setRemoteDescription(description);
    return setRemoteDescription({
      type: description.type,
      sdp: preferOpusPtime(description.sdp, ptimeMs),
    });
  }) as RTCPeerConnection["setRemoteDescription"];
  markVoice("opus-ptime", { ptimeMs });
}
