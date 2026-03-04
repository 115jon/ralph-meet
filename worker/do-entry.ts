// ============================================================================
// Durable Objects Worker Entry
//
// This is a separate worker that hosts all Durable Object classes.
// Splitting DOs into their own worker prevents the Cloudflare Workers runtime
// from sharing module-level I/O objects between the main Worker and DO
// contexts, which causes "Cannot perform I/O on behalf of a different
// Durable Object" errors in dev mode (Vite + @cloudflare/vite-plugin).
//
// In production, this worker is deployed separately via `script_name`
// references in the main worker's wrangler.toml.
// ============================================================================

export { MeetingRoom } from "./meeting-room";
export { RateLimiterDO } from "./rate-limiter-do";
export { VoiceRoom } from "./voice-room";

export default {
  async fetch(): Promise<Response> {
    return new Response("This worker only hosts Durable Objects", { status: 404 });
  },
};
