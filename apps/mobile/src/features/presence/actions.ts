import { useSession } from "@/features/auth/session";
import { sendPresenceUpdate } from "@/features/realtime/gateway";
import { showToast } from "@/ui";

import { postPresence } from "./api";
import { CUSTOM_STATUS_MAX, isUserStatus, type UserStatus } from "./status";

/** The user's saved status; "online" until the profile says otherwise. */
export function currentStatus(): UserStatus {
  const status = useSession.getState().user?.status;
  return isUserStatus(status) ? status : "online";
}

function currentCustomStatus(): string | null {
  return useSession.getState().user?.custom_status ?? null;
}

/**
 * Shows the change at once, saves it, and puts the old one back if the
 * server refuses. The gateway op keeps live sessions on the new status.
 */
async function save(status: UserStatus, customStatus: string | null) {
  const { patchUser } = useSession.getState();
  const previous = {
    status: currentStatus(),
    custom_status: currentCustomStatus(),
  };
  patchUser({ status, custom_status: customStatus });
  if (status !== previous.status) sendPresenceUpdate(status);
  try {
    const saved = await postPresence(status, customStatus);
    patchUser({
      status: saved.status,
      custom_status: saved.custom_status ?? null,
    });
  } catch {
    patchUser(previous);
    if (status !== previous.status) sendPresenceUpdate(previous.status);
    showToast({
      label: "Not saved",
      text: "Your status didn't change. Try again.",
      led: "danger",
    });
  }
}

export function setStatus(status: UserStatus): Promise<void> {
  if (status === currentStatus()) return Promise.resolve();
  return save(status, currentCustomStatus());
}

/** Trimmed; an empty one clears it. */
export function setCustomStatus(text: string): Promise<void> {
  const next = text.trim().slice(0, CUSTOM_STATUS_MAX) || null;
  if (next === currentCustomStatus()) return Promise.resolve();
  return save(currentStatus(), next);
}

/** PRESENCE_UPDATE about the user, from another device or the room. */
export function applySelfPresence(
  status: string,
  customStatus: string | null | undefined,
): void {
  const { patchUser } = useSession.getState();
  // Room snapshots carry no custom status; only the API's broadcast does.
  patchUser(
    customStatus === undefined
      ? { status }
      : { status, custom_status: customStatus },
  );
}
