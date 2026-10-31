import type { PartyTracksConfig } from "partytracks/client";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  installOpusPtimePreference,
  preferOpusPtime,
  resolveVoiceOpusPtime,
  VOICE_OPUS_PTIME_OVERRIDE_KEY,
} from "../opus-ptime";
import {
  PartyTracksTransport,
  type PartyTracksClient,
} from "../partytracks-transport";

// The SFU's answer to a microphone push, as the latency bench recorded it.
const SFU_ANSWER = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=recvonly",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=mid:1",
  "a=rtpmap:96 VP8/90000",
  "",
].join("\r\n");

describe("preferOpusPtime", () => {
  it("asks for 10 ms Opus frames and leaves FEC and everything else alone", () => {
    const munged = preferOpusPtime(SFU_ANSWER, 10);
    const lines = munged.split("\r\n");
    const fmtp = lines.indexOf("a=fmtp:111 minptime=10;useinbandfec=1");
    expect(fmtp).toBeGreaterThan(-1);
    expect(lines[fmtp + 1]).toBe("a=ptime:10");
    // Only that line was added; DTX stays off, FEC stays on.
    expect(munged.replace("a=ptime:10\r\n", "")).toBe(SFU_ANSWER);
    expect(munged).not.toContain("usedtx");
    // The video section is untouched.
    expect(
      lines.slice(lines.indexOf("m=video 9 UDP/TLS/RTP/SAVPF 96")),
    ).toEqual(
      SFU_ANSWER.split("\r\n").slice(
        SFU_ANSWER.split("\r\n").indexOf("m=video 9 UDP/TLS/RTP/SAVPF 96"),
      ),
    );
  });

  it("replaces an existing ptime and is idempotent", () => {
    const withPtime = SFU_ANSWER.replace(
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=fmtp:111 minptime=10;useinbandfec=1\r\na=ptime:20",
    );
    const munged = preferOpusPtime(withPtime, 10);
    expect(munged).toContain("a=ptime:10");
    expect(munged).not.toContain("a=ptime:20");
    expect(preferOpusPtime(munged, 10)).toBe(munged);
  });

  it("leaves audio sections without Opus alone", () => {
    const pcmu = "m=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\n";
    expect(preferOpusPtime(pcmu, 10)).toBe(pcmu);
  });
});

describe("resolveVoiceOpusPtime", () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  it("defaults to 10 ms and can be turned off for an A/B run", () => {
    expect(resolveVoiceOpusPtime(storage(null))).toBe(10);
    expect(resolveVoiceOpusPtime(storage("20"))).toBe(null);
    expect(resolveVoiceOpusPtime(storage("off"))).toBe(null);
    expect(resolveVoiceOpusPtime(storage("40"))).toBe(40);
    expect(resolveVoiceOpusPtime(storage("7"))).toBe(10);
    expect(resolveVoiceOpusPtime(null)).toBe(10);
    expect(VOICE_OPUS_PTIME_OVERRIDE_KEY).toBe("ralph:voice-opus-ptime");
  });
});

describe("installOpusPtimePreference", () => {
  function peerConnection() {
    const applied: RTCSessionDescriptionInit[] = [];
    const pc = {
      setRemoteDescription: vi.fn(async (description) => {
        applied.push(description);
      }),
    } as unknown as RTCPeerConnection;
    return { applied, pc };
  }

  it("munges remote answers and renegotiation offers, once per connection", async () => {
    const { applied, pc } = peerConnection();
    installOpusPtimePreference(pc, 10);
    installOpusPtimePreference(pc, 10);

    await pc.setRemoteDescription({ type: "answer", sdp: SFU_ANSWER });
    await pc.setRemoteDescription({ type: "offer", sdp: SFU_ANSWER });
    expect(applied.map((d) => d.type)).toEqual(["answer", "offer"]);
    for (const description of applied) {
      expect(description.sdp?.match(/a=ptime:10/g)).toHaveLength(1);
    }
  });

  function transportWith(opusPtimeMs: number | null) {
    const peerConnection$ = new Subject<RTCPeerConnection>();
    const client = {
      peerConnection$,
      session$: new Subject(),
      peerConnectionState$: new Subject(),
      push: vi.fn(),
      pull: vi.fn(),
    } as unknown as PartyTracksClient;
    const transport = new PartyTracksTransport(
      { roomSlug: "room", participantId: "participant", voiceToken: "token" },
      {
        factory: (_config: PartyTracksConfig) => client,
        resolveApiUrl: (path) => path,
        opusPtimeMs,
      },
    );
    return { peerConnection$, transport };
  }

  it("is installed by the transport on each PartyTracks peer connection", async () => {
    const { peerConnection$, transport } = transportWith(10);
    for (const { applied, pc } of [peerConnection(), peerConnection()]) {
      peerConnection$.next(pc);
      await pc.setRemoteDescription({ type: "answer", sdp: SFU_ANSWER });
      expect(applied[0]?.sdp).toContain("a=ptime:10");
    }
    transport.dispose();
  });

  it("leaves the SDP alone when turned off", async () => {
    const { peerConnection$, transport } = transportWith(null);
    const { applied, pc } = peerConnection();
    peerConnection$.next(pc);
    await pc.setRemoteDescription({ type: "answer", sdp: SFU_ANSWER });
    expect(applied[0]?.sdp).toBe(SFU_ANSWER);
    transport.dispose();
  });
});
