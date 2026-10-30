/**
 * User-facing copy for a failed API call.
 *
 * Server messages are written for logs ("D1_ERROR: …", "Authentication
 * required"), so they never reach the screen. Pick the copy from the HTTP
 * status instead and name what the person was trying to do:
 *
 *   describeApiError(err, "load your sessions")
 *   // "Unable to load your sessions. Check your connection and try again."
 *
 * `action` is a lowercase verb phrase that reads after "Unable to".
 */
export function describeApiError(error: unknown, action: string): string {
  const status = errorStatus(error);
  if (status === 401) {
    return `Your session has ended. Sign in again to ${action}.`;
  }
  if (status === 403) {
    return `You don't have permission to ${action}.`;
  }
  if (status === 404 || status === 410) {
    return `Unable to ${action}. It may have been deleted.`;
  }
  if (status === 413) {
    return `Unable to ${action}. The file is too large.`;
  }
  if (status === 429) {
    return `Unable to ${action} right now. Wait a moment and try again.`;
  }
  if (status !== null && status >= 400 && status < 500) {
    return `Unable to ${action}. Check the details and try again.`;
  }
  if (status !== null && status >= 500) {
    return `Unable to ${action}. Try again in a moment.`;
  }
  return `Unable to ${action}. Check your connection and try again.`;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}
