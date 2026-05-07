import { clog } from "@/lib/console-logger";

const stereoLog = clog("SFU:Stereo");
// ============================================================================
// StereoCodec — Stateless SDP and audio stream utilities for stereo WebRTC
// ============================================================================

/**
 * Bypass Chromium's APM mono downmix for stereo microphone input.
 *
 * Chromium's WebRTC pipeline forces mono encoding even with stereo=1 SDP.
 * This function creates a NEW track via Web Audio API that:
 *   1. Is NOT a getUserMedia track (PeerConnection treats these differently)
 *   2. Has explicit 2-channel output configuration
 *   3. Uses `channelInterpretation: 'discrete'` to prevent upmix/downmix
 *
 * On non-Chromium browsers (Firefox/Safari), stereo works natively.
 *
 * @returns A MediaStream containing the stereo-bypassed track.
 */
/** True when the browser is Chromium-based (Chrome, Edge, Opera, Brave). */
function isChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes("Chrome") || navigator.userAgent.includes("Edg");
}

export function createTrueStereoStream(rawStream: MediaStream): MediaStream {
  const rawAudioTrack = rawStream.getAudioTracks()[0];
  if (!rawAudioTrack) return rawStream;

  // Log the actual channel count from getUserMedia
  const settings = rawAudioTrack.getSettings();
  stereoLog.info(`Raw mic track: channelCount=${settings.channelCount ?? 'unknown'}, sampleRate=${settings.sampleRate}, label="${rawAudioTrack.label}"`);

  // Firefox/Safari natively support stereo WebRTC and do not need the Web Audio bypass.
  // Applying it on Firefox breaks the audio track on initial load (suspended AudioContext without user gesture).
  if (!isChromium()) {
    return rawStream;
  }


  // Create a Web Audio graph to produce a non-getUserMedia stereo track.
  // PeerConnection does NOT apply its internal APM to tracks from
  // createMediaStreamDestination — it only applies APM to getUserMedia tracks.
  const ctx = new AudioContext({ sampleRate: 48000 });
  const source = ctx.createMediaStreamSource(rawStream);
  const destination = ctx.createMediaStreamDestination();

  // Critical: set ALL channel properties on the destination BEFORE connecting
  destination.channelCount = 2;
  destination.channelCountMode = 'explicit';
  destination.channelInterpretation = 'discrete';  // Don't mix channels!

  // Force source to output as many channels as it has
  source.channelCount = settings.channelCount ?? 2;
  source.channelCountMode = 'max';
  source.channelInterpretation = 'discrete';

  source.connect(destination);
  ctx.resume().catch(() => { });

  const outTrack = destination.stream.getAudioTracks()[0];
  stereoLog.info(`Web Audio bypass active — output track channelCount=${outTrack?.getSettings?.()?.channelCount ?? 'unknown'}`);

  // Build a new stream with the bypassed audio + any video tracks
  const result = new MediaStream([outTrack]);
  rawStream.getVideoTracks().forEach(t => result.addTrack(t));
  return result;
}

/**
 * Force Opus to use stereo and high bitrate in SDP.
 * Applied to all audio (mic + screen) for maximum quality.
 *
 * When prefix is 'screen', DTX is disabled and bitrate is raised to 192kbps.
 * Screen audio typically contains music/system sounds where DTX comfort-noise
 * packets cause audible micro-dropouts during quiet passages. Voice (cam)
 * keeps DTX=1 for bandwidth savings during silence.
 */
export function mungeStereoOpus(sdp: string, prefix?: string): string {
  const lines = sdp.split('\r\n');
  let opusPayload: string | null = null;

  // Find opus payload type
  for (const line of lines) {
    if (line.toLowerCase().includes('a=rtpmap:') && line.toLowerCase().includes('opus/48000/2')) {
      const match = line.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
      if (match) opusPayload = match[1];
    }
  }

  if (!opusPayload) return sdp;

  // Use higher bitrate for screen sharing.
  // CRITICAL: Disable DTX (usedtx=0) for ALL tracks. If DTX is enabled on a perfectly silent
  // microphone (like a virtual audio cable), the browser sends 0 RTP packets.
  // The Cloudflare SFU requires at least one RTP packet to consider the track 'connected',
  // otherwise it throws 'empty_track_error' when peers try to pull it.
  const isScreen = prefix === 'screen';
  const bitrate = isScreen ? 192000 : 128000;
  const dtx = 0;

  return lines.map(line => {
    if (line.startsWith(`a=fmtp:${opusPayload}`)) {
      return `a=fmtp:${opusPayload} minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=${bitrate};maxplaybackrate=48000;usedtx=${dtx};cbr=0`;
    }
    return line;
  }).join('\r\n');
}
