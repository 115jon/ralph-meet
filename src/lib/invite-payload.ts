/**
 * Body for POST /api/servers/:id/invites. The route reads optional finite
 * `max_age` (seconds) and `max_uses`; a missing field means the invite never
 * expires or has no use limit, so unset (0) choices are omitted, not nulled.
 */
export interface InvitePayload {
  max_age?: number;
  max_uses?: number;
}

export function buildInvitePayload(options: {
  expiresHours: number;
  maxUses: number;
}): InvitePayload {
  const payload: InvitePayload = {};
  if (options.expiresHours > 0) {
    payload.max_age = Math.round(options.expiresHours * 3600);
  }
  if (options.maxUses > 0) payload.max_uses = options.maxUses;
  return payload;
}
