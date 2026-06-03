import { clog } from "@/lib/console-logger";

const log = clog("ChatScroll");

export function isChatScrollDebugEnabled(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.DEV === true
  );
}

export function debugChatScroll(event: string, details?: Record<string, unknown>) {
  if (!isChatScrollDebugEnabled()) return;
  if (details) {
    log.debug(event, details);
  } else {
    log.debug(event);
  }
}
