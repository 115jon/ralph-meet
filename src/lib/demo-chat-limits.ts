export const DEMO_CHAT_MAX_CONTENT_LENGTH = 1_000;
export const DEMO_CHAT_TTL_MINUTES = 10;

export function getDemoChatCharacterCounter(
  value: string,
  maxLength = DEMO_CHAT_MAX_CONTENT_LENGTH,
) {
  const remaining = Math.max(0, maxLength - value.length);
  return {
    remaining,
    label: `${remaining} character${remaining === 1 ? "" : "s"} left`,
  };
}
