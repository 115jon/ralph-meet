// ── Voice moves, client side ────────────────────────────────────────────────
// The mover asks POST /api/voice/move. The moved client's grant lives in
// voice-move-grants.ts (no imports, so the ticket client can use it).

import { apiPost } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";

/** Asks a voice view to switch to the channel it was moved to. */
export const VOICE_MOVE_EVENT = "voice-move";

export interface VoiceMoveDetail {
  serverId: string;
  channelId: string;
}

/** Copy for a refused move, by the route's error code. */
function describeMoveError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "NOT_IN_VOICE":
      return "They already left that voice channel.";
    case "ROLE_HIERARCHY":
      return "You can't move someone with an equal or higher role.";
    case "TARGET_CANNOT_VIEW":
      return "They can't see that channel.";
    case "MISSING_PERMISSIONS":
      return "You don't have permission to move members there.";
    default:
      return describeApiError(error, "move them");
  }
}

/**
 * Moves `userId` from one voice channel to another. Resolves with null on
 * success (or a no-op), else with the message to show.
 */
export async function requestVoiceMove(move: {
  serverId: string;
  userId: string;
  fromChannelId: string;
  toChannelId: string;
}): Promise<string | null> {
  if (move.fromChannelId === move.toChannelId) return null;
  try {
    await apiPost("/api/voice/move", {
      server_id: move.serverId,
      user_id: move.userId,
      from_channel_id: move.fromChannelId,
      to_channel_id: move.toChannelId,
    });
    return null;
  } catch (error) {
    return describeMoveError(error);
  }
}
