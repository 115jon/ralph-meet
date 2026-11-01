import type { LedState } from "@/ui";

/** The statuses /api/presence accepts (src/services/presence.service.ts). */
export const USER_STATUSES = ["online", "idle", "dnd", "offline"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export function isUserStatus(value: unknown): value is UserStatus {
  return USER_STATUSES.some((status) => status === value);
}

/** The web's names (UserAccountPopover): "offline" reads as Invisible. */
export const STATUS_LABEL: Record<UserStatus, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Invisible",
};

export const STATUS_HINT: Partial<Record<UserStatus, string>> = {
  dnd: "You won't get notification alerts",
  offline: "You'll appear offline but keep full access",
};

const STATUS_LED: Record<UserStatus, LedState> = {
  online: "talk",
  idle: "idle",
  dnd: "danger",
  offline: "off",
};

/** Your own presence LED: unlike a friend's, Invisible still shows (unlit). */
export function statusLed(status: UserStatus): LedState {
  return STATUS_LED[status];
}

/** The web's custom status input limit. */
export const CUSTOM_STATUS_MAX = 128;
