declare module "cloudflare:workers" {
  interface ProvidedEnv {
    CALLS_APP_SECRET: string;
    MEETING_ROOM: DurableObjectNamespace;
    VOICE_ROOM: DurableObjectNamespace;
  }
}
