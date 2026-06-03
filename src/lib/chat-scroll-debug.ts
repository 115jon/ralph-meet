export function isChatScrollDebugEnabled(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true
  );
}

export function debugChatScroll(event: string, details?: Record<string, unknown>) {
  if (!isChatScrollDebugEnabled()) return;
  if (details) {
    console.debug(`[ChatScroll] ${event}`, details);
  } else {
    console.debug(`[ChatScroll] ${event}`);
  }
}
