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
}

export { };

declare module "*.css?url" {
  const src: string;
  export default src;
}

