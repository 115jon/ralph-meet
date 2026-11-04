// ── Voice move grants ───────────────────────────────────────────────────────
// A member with MOVE_MEMBERS can move someone into a voice channel they may
// see but not join themselves (Discord parity). The move route signs a grant
// for that one user and channel; the moved client hands it back on its
// socket-ticket requests and on the global gateway's VoiceChannelJoin, and
// each of those accepts it in place of CONNECT. Nothing else is relaxed:
// VIEW_CHANNELS, server membership and the ticket itself are still checked.
//
// The signature proves who and where; the global gateway decides whether it
// is still live. It keeps only the user's latest grant (a later move kills
// the earlier one) and lets each grant be used once per purpose (room ticket,
// voice ticket, roster join): realtime/voice-move.ts.

import { openSignedToken, sealSignedToken } from "./socket-ticket";

const VOICE_MOVE_GRANT_VERSION = "vm1";

/** Long enough for the switch (leave, two tickets, joins), no longer. */
export const VOICE_MOVE_GRANT_TTL_MS = 90 * 1000;

export interface VoiceMoveGrantClaims {
  /** Unique per move; the global gateway's single-use key. */
  jti: string;
  subject: string;
  serverId: string;
  channelId: string;
  expiresAt: number;
}

export function issueVoiceMoveGrant(
  claims: VoiceMoveGrantClaims,
  secret: string,
): Promise<string> {
  return sealSignedToken(
    VOICE_MOVE_GRANT_VERSION,
    {
      jti: claims.jti,
      sub: claims.subject,
      srv: claims.serverId,
      ch: claims.channelId,
      exp: claims.expiresAt,
    },
    secret,
  );
}

/**
 * The grant's id and expiry when it is signed with `secret`, names `subject`
 * and `channelId` (and `serverId` when given), and has not expired; else null.
 * Whether it is still the user's live, unused grant is the gateway's call.
 */
export async function openVoiceMoveGrant(
  grant: unknown,
  secret: string | undefined,
  expected: {
    subject: string;
    channelId: string;
    serverId?: string | null;
    now?: number;
  },
): Promise<{ jti: string; expiresAt: number } | null> {
  if (!secret || typeof grant !== "string" || !grant) return null;
  const claims = await openSignedToken(VOICE_MOVE_GRANT_VERSION, grant, secret);
  if (!claims) return null;
  const now = expected.now ?? Date.now();
  if (
    typeof claims.jti !== "string" ||
    !claims.jti ||
    claims.sub !== expected.subject ||
    claims.ch !== expected.channelId ||
    (expected.serverId != null && claims.srv !== expected.serverId) ||
    typeof claims.exp !== "number" ||
    now >= claims.exp
  ) {
    return null;
  }
  return { jti: claims.jti, expiresAt: claims.exp };
}
