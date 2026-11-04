// Which sidebar voice members the viewer may drag, and where they may drop
// them. The sidebar's guess from each channel's effective permissions; the
// server re-checks on drop (including role hierarchy, which needs member
// roles the sidebar does not hold).

import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { Channel } from "@/lib/types";
import {
  canMoveMembersIn,
  canMoveMembersInto,
} from "@/lib/voice-move-permissions";

/** dnd-kit `data` on a dragged voice member row. */
export interface VoiceMemberDrag {
  type: "voice-member";
  userId: string;
  /** The voice channel the member is in. */
  channelId: string;
  name: string;
}

/** dnd-kit `data` on a voice channel that takes dropped members. */
export interface VoiceDropTarget {
  type: "voice-target";
  channelId: string;
}

export function isVoiceMemberDrag(value: unknown): value is VoiceMemberDrag {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "voice-member"
  );
}

export function isVoiceDropTarget(value: unknown): value is VoiceDropTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "voice-target"
  );
}

function voiceChannel(channels: readonly Channel[], channelId: string) {
  const channel = channels.find((c) => c.id === channelId);
  return channel?.channel_type === "voice" ? channel : null;
}

/** Only members of a voice channel, and only with MOVE_MEMBERS there. */
export function canDragVoiceMember(
  channels: readonly Channel[],
  channelId: string,
): boolean {
  const source = voiceChannel(channels, channelId);
  return !!source && canMoveMembersIn(source.permissions ?? null);
}

/**
 * Another voice channel of the server: one the viewer may move members into,
 * or, for the viewer's own row, one they may join (a drag of yourself is a
 * normal join).
 */
export function canDropVoiceMember(
  channels: readonly Channel[],
  drag: Pick<VoiceMemberDrag, "userId" | "channelId">,
  toChannelId: string,
  currentUserId: string | null,
): boolean {
  if (toChannelId === drag.channelId) return false;
  if (!canDragVoiceMember(channels, drag.channelId)) return false;
  const target = voiceChannel(channels, toChannelId);
  if (!target) return false;
  const permissions = target.permissions ?? null;
  if (drag.userId === currentUserId) {
    return (
      permissions !== null &&
      hasPermission(
        permissions,
        PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT,
      )
    );
  }
  return canMoveMembersInto(permissions);
}

/** The "Move to" list for someone else's row, in sidebar order. */
export function voiceMoveTargets(
  channels: readonly Channel[],
  drag: Pick<VoiceMemberDrag, "userId" | "channelId">,
  currentUserId: string | null,
): Channel[] {
  if (drag.userId === currentUserId) return [];
  return channels
    .filter((channel) =>
      canDropVoiceMember(channels, drag, channel.id, currentUserId),
    )
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
