export { MeetingRoom as RootMeetingRoom } from "./realtime/meeting-room";
export { RateLimiterDO as RootRateLimiterDO } from "./realtime/rate-limiter-do";
export { VoiceRoom as RootVoiceRoom } from "./realtime/voice-room";

export default {
  async fetch(): Promise<Response> {
    return new Response("DO test worker", { status: 404 });
  },
};
