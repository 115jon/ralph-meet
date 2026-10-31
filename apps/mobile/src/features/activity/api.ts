import { apiFetch, apiJson, ApiError } from "@/lib/api";

import { NotificationListSchema } from "./schema";

const PATH = "/api/notifications";

/** GET /api/notifications: newest first, the latest 50. */
export function fetchNotifications() {
  return apiJson(`${PATH}?limit=50`, NotificationListSchema);
}

/** PATCH /api/notifications: marks these (or all) read; the server echoes NOTIFICATIONS_READ. */
export async function markNotificationsRead(
  target: { ids: readonly string[] } | { all: true },
): Promise<void> {
  const response = await apiFetch(PATH, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
  });
  if (!response.ok) throw new ApiError(response.status, PATH);
}
