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
export function createTrueStereoStream(rawStream: MediaStream): MediaStream {
  const rawAudioTrack = rawStream.getAudioTracks()[0];
  if (!rawAudioTrack) return rawStream;

  // Log the actual channel count from getUserMedia
  const settings = rawAudioTrack.getSettings();
  console.log(`[SFU:Stereo] Raw mic track: channelCount=${settings.channelCount ?? 'unknown'}, sampleRate=${settings.sampleRate}, label="${rawAudioTrack.label}"`);

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
  console.log(`[SFU:Stereo] Web Audio bypass active — output track channelCount=${outTrack?.getSettings?.()?.channelCount ?? 'unknown'}`);

  // Build a new stream with the bypassed audio + any video tracks
  const result = new MediaStream([outTrack]);
  rawStream.getVideoTracks().forEach(t => result.addTrack(t));
  return result;
}

/**
 * Force Opus to use stereo and high bitrate in SDP.
 * Applied to all audio (mic + screen) for maximum quality.
 */
export function mungeStereoOpus(sdp: string, _prefix?: string): string {
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

  return lines.map(line => {
    if (line.startsWith(`a=fmtp:${opusPayload}`)) {
      // Fully rewrite the Opus fmtp line with all stereo and quality params.
      // - stereo=1: tell encoder to encode stereo
      // - sprop-stereo=1: signal to remote peer that we send stereo
      // - maxaveragebitrate=128000: high quality stereo (speech-optimized)
      // - maxplaybackrate=48000: full sample rate
      // - useinbandfec=1: forward error correction for quality
      // - usedtx=1: enable discontinuous transmission — sends tiny comfort-noise
      //   packets (~1-2 kbps) during silence instead of full-rate frames, saving
      //   massive bandwidth on idle/silent calls. Does NOT kill the stream or
      //   affect stereo; transition DTX→voice is ~10ms (imperceptible).
      // - cbr=0: variable bitrate for better stereo quality
      return `a=fmtp:${opusPayload} minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;maxplaybackrate=48000;usedtx=1;cbr=0`;
    }
    return line;
  }).join('\r\n');
}
