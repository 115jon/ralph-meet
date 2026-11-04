// ============================================================================
// Saved device choices (microphone, camera, speaker)
//
// Settings keep the device id the user picked plus its label and groupId.
// Device ids can change (another browser profile, cleared site data, a driver
// reinstall), so a saved id that no longer matches is looked up again by
// label, then by groupId when only one endpoint has it.
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
 * Windows decorates endpoint names ("Microphone (Shure MV7)"), so one label
 * holding the other counts as the same device. Siblings on one card, like
 * "Line In (Realtek Audio)" and "Microphone (Realtek Audio)", do not overlap.
 */
function labelsOverlap(a: string, b: string) {
  return !!a && !!b && (a.includes(b) || b.includes(a));
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

interface DeviceListEntry {
  deviceId: string;
  groupId?: string;
  label: string;
}

export interface StoredDeviceMatch<T extends DeviceListEntry> {
  device: T;
  by: "id" | "label" | "groupId";
}

/**
 * Finds the saved device in a readable device list: by id, then by label,
 * then by groupId. On Windows a sound card's Microphone, Line In and Stereo
 * Mix share one groupId, so a group match is accepted only when one physical
 * endpoint has it, or one endpoint in it has an overlapping label. Returns
 * null when the device is not listed.
 */
export function matchStoredDevice<T extends DeviceListEntry>(
  candidates: readonly T[],
  stored: StoredDevice,
): StoredDeviceMatch<T> | null {
  const { deviceId, label, groupId } = stored;
  if (!deviceId || deviceId === "default") return null;
  if (!deviceId.startsWith("native:")) {
    const exact = candidates.find((d) => d.deviceId === deviceId);
    if (exact) return { device: exact, by: "id" };
  }

  const physical = candidates.filter(
    (d) => d.deviceId && !isVirtualDeviceId(d.deviceId),
  );
  const wantedLabel = normalizedLabel(label);
  const byLabel = wantedLabel
    ? physical.filter((d) => normalizedLabel(d.label) === wantedLabel)
    : [];
  if (byLabel.length > 0) {
    // Two endpoints with one name: prefer the one in the saved group.
    const device =
      (groupId && byLabel.find((d) => d.groupId === groupId)) || byLabel[0];
    return { device, by: "label" };
  }

  if (groupId) {
    const byGroup = physical.filter((d) => d.groupId === groupId);
    if (byGroup.length === 1) return { device: byGroup[0], by: "groupId" };
    const overlapping = byGroup.filter((d) =>
      labelsOverlap(normalizedLabel(d.label), wantedLabel),
    );
    if (overlapping.length === 1) {
      return { device: overlapping[0], by: "groupId" };
    }
  }
  return null;
}

export async function resolveStoredDeviceId(
  kind: MediaDeviceKind,
  stored: StoredDevice,
  log: Logger = deviceLog,
): Promise<StoredDeviceLookup> {
  const { deviceId } = stored;
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

  const match = matchStoredDevice(candidates, stored);
  if (match) {
    if (match.by !== "id") {
      log.info(
        `Resolved stale ${kind} deviceId by ${match.by}: ${match.device.label || "unlabeled device"}`,
      );
    }
    return { deviceId: match.device.deviceId, unverified: false };
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
  const storedLabel = normalizedLabel(stored.label);
  const actualLabel = normalizedLabel(actual.label);
  if (storedLabel && storedLabel === actualLabel) return actualId;
  // A shared groupId alone is not enough: sibling inputs of one sound card
  // share it. With both labels known they must overlap as well.
  const sameGroup = !!stored.groupId && stored.groupId === actual.groupId;
  if (!sameGroup) return null;
  if (storedLabel && actualLabel) {
    return labelsOverlap(storedLabel, actualLabel) ? actualId : null;
  }
  return actualId;
}
