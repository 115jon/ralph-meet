// ============================================================================
// Saved device choices (microphone, camera, speaker): the browser side.
//
// The decisions (matching a saved id by id → label → unique groupId, what a
// hidden list means, what to save) live in @ralph/voice (devices.ts,
// packages/voice/DEVICES.md). This file only reads the browser's device list
// for them.
//
// Before the page has media permission, enumerateDevices() hides ids and
// labels. Desktop CEF grants capture per request and records nothing, so
// every launch starts in that state until the first getUserMedia.
// ============================================================================

import {
  SYSTEM_DEFAULT_DEVICE_ID,
  isSavedDeviceChoice,
  resolveOutputDevice,
  resolveSavedDevice,
  type DeviceResolution,
  type ListedDevice,
  type SavedDevice,
} from "@ralph/voice";
import { clog } from "@/lib/console-logger";

const deviceLog = clog("StoredDevice");

type Logger = Pick<ReturnType<typeof clog>, "info" | "warn">;

export type StoredDevice = SavedDevice;

export interface StoredDeviceLookup {
  /** The id to open: the saved id, a refreshed id, or "default". */
  deviceId: string | undefined;
  /**
   * True when the device list was hidden (no permission yet), so the saved
   * id was passed through without checking it exists.
   */
  unverified: boolean;
}

const canListDevices = () =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.enumerateDevices;

/**
 * The browser's current list of `kind`: null when it cannot list, empty for
 * the system default (nothing to look up).
 */
async function listDevicesFor(
  kind: MediaDeviceKind,
  saved: StoredDevice,
): Promise<ListedDevice[] | null> {
  if (!isSavedDeviceChoice(saved.deviceId)) return [];
  if (!canListDevices()) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === kind);
}

function logResolution(
  kind: MediaDeviceKind,
  saved: StoredDevice,
  resolution: DeviceResolution,
  log: Logger,
) {
  if (resolution.outcome === "listed" && resolution.by !== "id") {
    log.info(`Resolved stale ${kind} deviceId by ${resolution.by}`);
  } else if (resolution.outcome === "missing") {
    log.warn(
      saved.deviceId?.startsWith("native:")
        ? `Native ${kind} endpoint is not exposed by CEF; falling back to system default`
        : `Stored ${kind} deviceId is gone; falling back to system default`,
    );
  }
}

/** Looks the saved device up in the browser's live device list. */
export async function lookupSavedDevice(
  kind: MediaDeviceKind,
  saved: StoredDevice,
  log: Logger = deviceLog,
): Promise<DeviceResolution> {
  // Awaits enumerateDevices() directly (no helper hop): capture ordering
  // in local-media-manager depends on how soon this settles.
  let list: ListedDevice[] | null = [];
  if (isSavedDeviceChoice(saved.deviceId)) {
    list = canListDevices()
      ? (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === kind,
        )
      : null;
  }
  const resolution = resolveSavedDevice(saved, list);
  logResolution(kind, saved, resolution, log);
  return resolution;
}

/**
 * The sink id to route remote audio to for the saved speaker
 * (`resolveOutputDevice`). A failed lookup tries the saved id as it is.
 */
export async function resolveOutputSinkId(
  saved: StoredDevice,
  log: Logger = deviceLog,
): Promise<string> {
  try {
    const list = await listDevicesFor("audiooutput", saved);
    const resolution = resolveSavedDevice(saved, list);
    logResolution("audiooutput", saved, resolution, log);
    return resolveOutputDevice(saved, list);
  } catch {
    return saved.deviceId || SYSTEM_DEFAULT_DEVICE_ID;
  }
}

/** {@link lookupSavedDevice}, as the id to open and whether it was checked. */
export async function resolveStoredDeviceId(
  kind: MediaDeviceKind,
  stored: StoredDevice,
  log: Logger = deviceLog,
): Promise<StoredDeviceLookup> {
  const resolution = await lookupSavedDevice(kind, stored, log);
  return {
    deviceId: resolution.deviceId,
    unverified: resolution.outcome === "unverified",
  };
}
