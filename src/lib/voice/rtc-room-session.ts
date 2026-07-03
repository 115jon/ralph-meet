export const RTC_CONTROL_HEARTBEAT_INTERVAL_MS = 15_000;
export const RTC_CONTROL_ZOMBIE_TIMEOUT_MS = RTC_CONTROL_HEARTBEAT_INTERVAL_MS * 3;

export const RTC_VOICE_HEARTBEAT_INTERVAL_MS = 15_000;
export const RTC_VOICE_ZOMBIE_TIMEOUT_MS = RTC_VOICE_HEARTBEAT_INTERVAL_MS * 6;

export const RTC_CONTROL_RECONNECT_GRACE_MS = 120_000;
export const RTC_MEDIA_RECONNECT_GRACE_MS = 30_000;
export const RTC_RECONNECT_GRACE_MS = RTC_CONTROL_RECONNECT_GRACE_MS;

export interface VoiceSessionCheckRequest {
  user_id?: string;
  channel_id?: string;
  session_id?: string | null;
  require_exact_session?: boolean;
  require_channel_match?: boolean;
}

export interface VoiceSessionCheckResponse {
  allowed?: boolean;
  connected?: boolean;
  exact_session_matched?: boolean;
}

export interface ParsedVoiceSessionCheckRequest {
  userId: string;
  channelId: string;
  sessionId: string | null;
  requireExactSession: boolean;
  requireChannelMatch: boolean;
}

export function parseVoiceSessionCheckRequest(
  body: VoiceSessionCheckRequest,
): ParsedVoiceSessionCheckRequest | null {
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
  const sessionId = typeof body.session_id === "string" && body.session_id.trim()
    ? body.session_id.trim()
    : null;
  const requireExactSession = body.require_exact_session === true;
  const requireChannelMatch = body.require_channel_match !== false;

  if (!userId || (requireChannelMatch && !channelId)) {
    return null;
  }

  return {
    userId,
    channelId,
    sessionId,
    requireExactSession,
    requireChannelMatch,
  };
}

export function resolveVoiceSessionCheckResponse(
  userMatchedScope: boolean,
  exactSessionMatched: boolean,
  requireExactSession: boolean,
): VoiceSessionCheckResponse {
  return {
    allowed: requireExactSession ? exactSessionMatched : userMatchedScope,
    connected: userMatchedScope,
    exact_session_matched: exactSessionMatched,
  };
}
