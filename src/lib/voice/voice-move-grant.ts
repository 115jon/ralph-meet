// ── Voice move grants ───────────────────────────────────────────────────────
// A member with MOVE_MEMBERS can move someone into a voice channel they may
// see but not join themselves (Discord parity). The move route signs a grant
// for that one user and channel; the moved client hands it back on its
// socket-ticket requests and on the global gateway's VoiceChannelJoin, and
// each of those accepts it in place of CONNECT. Nothing else is relaxed:
// VIEW_CHANNELS, server membership and the ticket itself are still checked.

import { openSignedToken, sealSignedToken } from "./socket-ticket";

const VOICE_MOVE_GRANT_VERSION = "vm1";

/**
 * Long enough to cover the switch and a few reconnects after it. Once it
 * runs out, a user without CONNECT who drops out cannot rejoin, which is
 * where Discord leaves them too.
 */
export const VOICE_MOVE_GRANT_TTL_MS = 10 * 60 * 1000;

export interface VoiceMoveGrantClaims {
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
      sub: claims.subject,
      srv: claims.serverId,
      ch: claims.channelId,
      exp: claims.expiresAt,
    },
    secret,
  );
}

/** Whether `grant` lets `subject` into `channelId` now. */
export async function verifyVoiceMoveGrant(
  grant: unknown,
  secret: string | undefined,
  expected: {
    subject: string;
    channelId: string;
    serverId?: string | null;
    now?: number;
  },
): Promise<boolean> {
  if (!secret || typeof grant !== "string" || !grant) return false;
  const claims = await openSignedToken(VOICE_MOVE_GRANT_VERSION, grant, secret);
  if (!claims) return false;
  const now = expected.now ?? Date.now();
  return (
    claims.sub === expected.subject &&
    claims.ch === expected.channelId &&
    (expected.serverId == null || claims.srv === expected.serverId) &&
    typeof claims.exp === "number" &&
    now < claims.exp
  );
}
