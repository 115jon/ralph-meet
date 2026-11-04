// The grant the last VoiceMove frame carried. The moved client hands it back
// on its socket tickets and on the gateway's VoiceChannelJoin for that
// channel, where it stands in for CONNECT (see voice-move-grant.ts). One at a
// time: a newer move replaces it, and it is dropped once the join it was for
// has gone through, or when the user leaves. The server spends it once per
// use and only honours the latest anyway; this keeps the client from
// offering stale grants.

let current: { channelId: string; grant: string; expiresAt: number } | null =
  null;

/** Keeps the grant a VoiceMove frame carried, replacing any earlier one. */
export function rememberVoiceMoveGrant(
  channelId: string,
  grant: string,
  expiresAt: number,
): void {
  current = { channelId, grant, expiresAt };
}

/** The unexpired move grant for `channelId`, if this client was moved there. */
export function voiceMoveGrantFor(
  channelId: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!channelId || !current || current.channelId !== channelId) {
    return undefined;
  }
  if (now >= current.expiresAt) {
    current = null;
    return undefined;
  }
  return current.grant;
}

/** Drops the grant (for `channelId` only, when given). */
export function clearVoiceMoveGrant(channelId?: string): void {
  if (!channelId || current?.channelId === channelId) current = null;
}
