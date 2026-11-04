// The grant a VoiceMove frame carried, per channel. The moved client hands it
// back on its socket tickets and on the gateway's VoiceChannelJoin for that
// channel, where it stands in for CONNECT (see voice-move-grant.ts).

const grants = new Map<string, { grant: string; expiresAt: number }>();

/** Keeps the grant a VoiceMove frame carried for its channel. */
export function rememberVoiceMoveGrant(
  channelId: string,
  grant: string,
  expiresAt: number,
): void {
  grants.set(channelId, { grant, expiresAt });
}

/** The unexpired move grant for `channelId`, if this client was moved there. */
export function voiceMoveGrantFor(
  channelId: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!channelId) return undefined;
  const entry = grants.get(channelId);
  if (!entry) return undefined;
  if (now >= entry.expiresAt) {
    grants.delete(channelId);
    return undefined;
  }
  return entry.grant;
}

export function clearVoiceMoveGrantsForTests(): void {
  grants.clear();
}
