export type VoiceMemberConnectionState = "connected" | "reconnecting";

export interface VoiceMemberConnectionInfo {
  connected?: boolean;
  connection_state?: VoiceMemberConnectionState;
  disconnected_at?: number | null;
  reconnect_expires_at?: number | null;
}

export interface VoiceMemberIdentityInfo {
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface VoiceMemberStreamDisplayInfo extends VoiceMemberConnectionInfo {
  self_stream?: boolean;
}

export function isVoiceMemberReconnecting(member: VoiceMemberConnectionInfo): boolean {
  return member.connection_state === "reconnecting" || member.connected === false;
}

export function shouldShowVoiceMemberStreamState(
  member: VoiceMemberStreamDisplayInfo,
  options?: {
    isCurrentUser?: boolean;
    isCurrentClientVoiceConnected?: boolean;
  },
): boolean {
  if (!member.self_stream) return false;
  if (isVoiceMemberReconnecting(member)) return false;
  if (options?.isCurrentUser && !options.isCurrentClientVoiceConnected) return false;
  return true;
}

export function getNextVoicePresenceAlarmTime(
  now: number,
  fallbackIntervalMs: number,
  deadlines: Array<number | null | undefined>,
): number {
  const fallback = now + fallbackIntervalMs;
  const validDeadlines = deadlines
    .filter((deadline): deadline is number => typeof deadline === "number" && Number.isFinite(deadline));

  if (validDeadlines.some((deadline) => deadline <= now)) {
    return now;
  }

  const nextDeadline = validDeadlines
    .sort((a, b) => a - b)[0];

  return Math.min(nextDeadline ?? fallback, fallback);
}

export function refreshVoiceMemberIdentity<T extends VoiceMemberConnectionInfo & VoiceMemberIdentityInfo>(
  member: T,
  identity: VoiceMemberIdentityInfo,
): T {
  return {
    ...member,
    name: identity.name,
    username: identity.username,
    display_name: identity.display_name,
    avatar_url: identity.avatar_url,
  };
}
