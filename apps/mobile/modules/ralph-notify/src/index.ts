import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// Message notifications drawn natively on Android (MessagingStyle, Reply,
// Mark as read) from the server's data-only pushes. JS only mirrors the
// session for the code that runs with the app killed, and says what is on
// screen and what was read. Elsewhere every function is a safe no-op.

export interface NotifySession {
  readonly token: string;
  readonly apiBaseUrl: string;
  readonly userId: string;
  /** The display name; replies show as "You" regardless. */
  readonly userName: string;
  readonly userAvatar: string | null;
  /** The app's URL scheme, for the links notifications open. */
  readonly scheme: string;
}

interface RalphNotifyNative {
  setSession(session: NotifySession): void;
  clearSession(): void;
  setActiveConversation(channelId: string | null): void;
  clearConversation(channelId: string): void;
  clearAll(): void;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<RalphNotifyNative>("RalphNotify")
    : null;

/**
 * True when this build draws its own notifications. Only then does the app
 * ask the server for data-only pushes; an older dev client keeps the
 * system-drawn ones.
 */
export const isAvailable = native !== null;

/** Signed in, or the profile changed: what the notification code may use. */
export function setSession(session: NotifySession): void {
  native?.setSession(session);
}

/** Signed out: forget the token and take every notification and shortcut down. */
export function clearSession(): void {
  native?.clearSession();
}

/** The conversation in front of the user; its pushes do not notify. */
export function setActiveConversation(channelId: string | null): void {
  native?.setActiveConversation(channelId);
}

/** The conversation was read: its notification goes. */
export function clearConversation(channelId: string): void {
  native?.clearConversation(channelId);
}

export function clearAll(): void {
  native?.clearAll();
}
