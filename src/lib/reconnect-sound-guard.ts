import type { VoiceChannelMember } from "@/lib/chat-reducer";
import type { Message } from "@/lib/types";

let activeSuppressionToken = 0;
let suppressUntil = 0;

export function beginReconnectSoundSuppression(): () => void {
  activeSuppressionToken += 1;
  const token = activeSuppressionToken;
  suppressUntil = Number.MAX_SAFE_INTEGER;

  return () => {
    if (activeSuppressionToken === token) {
      suppressUntil = 0;
    }
  };
}

export function areReconnectSoundsSuppressed(now = Date.now()): boolean {
  return suppressUntil > now;
}

export function getVoiceChannelPresenceSound(
  prevMembers: VoiceChannelMember[],
  nextMembers: VoiceChannelMember[],
  myUserId: string | null | undefined,
): "join" | "leave" | null {
  if (!myUserId) return null;

  const iAmInChannel = nextMembers.some((member) => member.clerk_user_id === myUserId);
  if (!iAmInChannel) return null;

  const prevIds = new Set(prevMembers.map((member) => member.clerk_user_id));
  const nextIds = new Set(nextMembers.map((member) => member.clerk_user_id));

  const someoneJoined = nextMembers.some(
    (member) => member.clerk_user_id !== myUserId && !prevIds.has(member.clerk_user_id),
  );
  if (someoneJoined) return "join";

  const someoneLeft = prevMembers.some(
    (member) => member.clerk_user_id !== myUserId && !nextIds.has(member.clerk_user_id),
  );
  if (someoneLeft) return "leave";

  return null;
}

function getAppendedMessages(previousMessages: Message[], nextMessages: Message[]): Message[] {
  if (nextMessages.length <= previousMessages.length) return [];

  for (let index = 0; index < previousMessages.length; index += 1) {
    if (previousMessages[index]?.id !== nextMessages[index]?.id) {
      return [];
    }
  }

  return nextMessages.slice(previousMessages.length);
}

export function shouldPlayCurrentChannelMessageSound(
  previousMessages: Message[],
  nextMessages: Message[],
  currentUserId: string | null | undefined,
): boolean {
  if (!currentUserId) return false;

  const appendedMessages = getAppendedMessages(previousMessages, nextMessages);
  if (appendedMessages.length === 0) return false;

  return appendedMessages.some((message) => message.author_id !== currentUserId);
}

export function __resetReconnectSoundGuardForTests(): void {
  activeSuppressionToken = 0;
  suppressUntil = 0;
}
