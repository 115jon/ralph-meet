// ============================================================================
// VoiceRoom compatibility export
//
// Live room-scoped RTC media traffic is owned by RtcRoom via RtcRoomMedia.
// This module remains so existing Durable Object bindings, migrations, and
// focused helper tests can continue to resolve the historical VoiceRoom name.
// ============================================================================

export * from "./rtc-room-media";
export { RtcRoomMedia as VoiceRoom } from "./rtc-room-media";
