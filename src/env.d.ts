/// <reference types="vite/client" />

// Augment the CloudflareEnv interface with our custom bindings
// These are defined in wrangler.toml and injected at runtime

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    CACHE: KVNamespace;
    MEETING_ROOM: DurableObjectNamespace;
    VOICE_ROOM: DurableObjectNamespace;
    RATE_LIMITER: DurableObjectNamespace;
  }

  // ── Chromium Insertable Streams (WebRTC Breakout Box) ───────────────────
  // These APIs are Chromium-only (Chrome 94+, Edge 94+).
  // Used to bypass Chrome's APM mono downmix for true stereo mic input.

  interface MediaStreamTrackProcessorInit {
    track: MediaStreamTrack;
  }

   
  var MediaStreamTrackProcessor: {
    prototype: MediaStreamTrackProcessor;
    new(init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessor;
  } | undefined;

  interface MediaStreamTrackProcessor {
    readonly readable: ReadableStream;
  }

  interface MediaStreamTrackGeneratorInit {
    kind: 'audio' | 'video';
  }

   
  var MediaStreamTrackGenerator: {
    prototype: MediaStreamTrackGenerator;
    new(init: MediaStreamTrackGeneratorInit): MediaStreamTrackGenerator;
  } | undefined;

  interface MediaStreamTrackGenerator extends MediaStreamTrack {
    readonly writable: WritableStream;
  }
}

export { };

declare module "*.css?url" {
  const src: string;
  export default src;
}
