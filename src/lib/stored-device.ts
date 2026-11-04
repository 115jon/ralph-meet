// ============================================================================
// Saved device choices (microphone, camera, speaker)
//
// Settings keep the device id the user picked plus its label and groupId.
// Device ids can change (another browser profile, cleared site data, a driver
// reinstall), so a saved id that no longer matches is looked up again by
// groupId, then by label.
//
// Before the page has media permission, enumerateDevices() hides ids and
// labels. Desktop CEF grants capture per request and records nothing, so
// every launch starts in that state until the first getUserMedia. A hidden
// list says nothing about whether the saved device exists, so the saved id is
// passed through unverified instead of being swapped for "default".
// ============================================================================

import { clog } from "@/lib/console-logger";

const deviceLog = clog("StoredDevice");

type Logger = Pick<ReturnType<typeof clog>, "info" | "warn">;

export interface StoredDevice {
  deviceId?: string;
  label?: string;
  groupId?: string;
}

export interface StoredDeviceLookup {
  /** The id to open: the saved id, a refreshed id, or "default". */
  deviceId: string | undefined;
  /**
   * True when the device list was hidden (no permission yet), so the saved
   * id was passed through without checking it exists.
   */
  unverified: boolean;
}

/** Chromium's "default" and "communications" entries alias a real device. */
function isVirtualDeviceId(deviceId: string) {
  return deviceId === "default" || deviceId === "communications";
}

function normalizedLabel(label: string | undefined) {
  return label?.trim().toLowerCase() ?? "";
}

/**
 * True when the browser lists devices of a kind but hides their ids and
 * labels until permission is granted. An empty list means none exist.
 */
export function isHiddenDeviceList(devices: readonly MediaDeviceInfo[]) {
  return (
    devices.length > 0 &&
    !devices.some((device) => device.deviceId && device.label)
  );
}

export async function resolveStoredDeviceId(
  kind: MediaDeviceKind,
  stored: StoredDevice,
  log: Logger = deviceLog,
): Promise<StoredDeviceLookup> {
  const { deviceId, label, groupId } = stored;
  if (!deviceId || deviceId === "default") {
    return { deviceId, unverified: false };
  }
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return { deviceId, unverified: true };
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const candidates = devices.filter((d) => d.kind === kind);
  if (isHiddenDeviceList(candidates)) {
    return { deviceId, unverified: true };
  }

  if (
    !deviceId.startsWith("native:") &&
    candidates.some((d) => d.deviceId === deviceId)
  ) {
    return { deviceId, unverified: false };
  }

  const physical = candidates.filter((d) => !isVirtualDeviceId(d.deviceId));
  const byGroup = groupId
    ? physical.find((d) => d.groupId && d.groupId === groupId)
    : undefined;
  if (byGroup) {
    log.info(
      `Resolved stale ${kind} deviceId by groupId: ${byGroup.label || "unlabeled device"}`,
    );
    return { deviceId: byGroup.deviceId, unverified: false };
  }

  const wantedLabel = normalizedLabel(label);
  const byLabel = wantedLabel
    ? physical.find((d) => normalizedLabel(d.label) === wantedLabel)
    : undefined;
  if (byLabel) {
    log.info(`Resolved stale ${kind} deviceId by label: ${byLabel.label}`);
    return { deviceId: byLabel.deviceId, unverified: false };
  }

  if (deviceId.startsWith("native:")) {
    log.warn(
      `Native ${kind} endpoint is not exposed by CEF; falling back to system default`,
    );
  } else {
    log.warn(`Stored ${kind} deviceId is gone; falling back to system default`);
  }
  return { deviceId: "default", unverified: false };
}

/**
 * The id to save after capture opened `actual`, or null to keep the saved
 * choice as it is.
 *
 * Only a refreshed id for the same physical device is saved. A capture that
 * fell back to another device (the saved one is unplugged, or the list was
 * hidden) leaves the choice alone, so the device is used again once it is
 * back. "System default" stays "default" and keeps following the OS.
 */
export function refreshedDeviceId(
  stored: StoredDevice,
  actual: StoredDevice,
): string | null {
  const storedId = stored.deviceId;
  const actualId = actual.deviceId;
  if (!storedId || storedId === "default") return null;
  if (!actualId || actualId === storedId || isVirtualDeviceId(actualId)) {
    return null;
  }
  const sameGroup = !!stored.groupId && stored.groupId === actual.groupId;
  const wantedLabel = normalizedLabel(stored.label);
  const sameLabel =
    !!wantedLabel && wantedLabel === normalizedLabel(actual.label);
  return sameGroup || sameLabel ? actualId : null;
}
