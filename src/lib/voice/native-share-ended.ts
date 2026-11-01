/**
 * Decides what the renderer does when the desktop backend emits
 * `native-screen-share-ended`, the event a native (hardware H.264) share sends
 * when it ends itself.
 *
 * Payload: `{ reason: "source-closed" | "connection-failed", detail: string }`.
 * Older builds sent a bare string such as `"source-closed: target_exited"`;
 * both shapes are accepted.
 */

export type NativeShareEndedReason = "source-closed" | "connection-failed";

export interface NativeShareEndedPayload {
  reason: NativeShareEndedReason | "unknown";
  detail: string;
}

/** `fallback-cef`: restart the same source through CEF capture. */
export type NativeShareEndedAction = "ignore" | "stop" | "fallback-cef";

function normalizeReason(value: unknown): NativeShareEndedPayload["reason"] {
  return value === "source-closed" || value === "connection-failed"
    ? value
    : "unknown";
}

export function parseNativeShareEndedPayload(
  payload: unknown,
): NativeShareEndedPayload {
  if (typeof payload === "string") {
    const separator = payload.indexOf(":");
    const reason = separator === -1 ? payload : payload.slice(0, separator);
    const detail = separator === -1 ? "" : payload.slice(separator + 1);
    return { reason: normalizeReason(reason.trim()), detail: detail.trim() };
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return {
      reason: normalizeReason(record.reason),
      detail: typeof record.detail === "string" ? record.detail : "",
    };
  }
  return { reason: "unknown", detail: "" };
}

/**
 * - Not sharing: ignore (late event after the user already stopped).
 * - Connection lost mid-share: fall back to CEF capture of the same source
 *   when WGC/CEF capture is allowed; under the hook-exclusive policy, stop.
 * - Source closed (or anything unrecognized): stop, as before.
 */
export function resolveNativeShareEndedAction(
  payload: NativeShareEndedPayload,
  options: { isSharing: boolean; wgcCaptureAllowed: boolean },
): NativeShareEndedAction {
  if (!options.isSharing) return "ignore";
  if (payload.reason === "connection-failed" && options.wgcCaptureAllowed) {
    return "fallback-cef";
  }
  return "stop";
}
