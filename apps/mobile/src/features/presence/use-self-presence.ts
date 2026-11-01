import { useSession } from "@/features/auth/session";

import { isUserStatus, type UserStatus } from "./status";

/** Your saved status; "online" until the profile loads. */
export function useSelfStatus(): UserStatus {
  return useSession((s) => {
    const status = s.user?.status;
    return isUserStatus(status) ? status : "online";
  });
}

/** Your custom status, trimmed; null when none is set. */
export function useSelfCustomStatus(): string | null {
  return useSession((s) => s.user?.custom_status?.trim() || null);
}
