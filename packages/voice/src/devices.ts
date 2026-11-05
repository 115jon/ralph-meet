// Device decisions: which microphone, camera or speaker to open given the
// saved choice, the live device list and whether that list is readable yet;
// whether a live capture still answers the request; when to capture again;
// what to save after a capture opened. Pure functions, no React, no DOM: the
// platform enumerates, opens and routes devices and asks these. See
// DEVICES.md.

/** The OS's own default endpoint. A saved "default" follows the OS. */
export const SYSTEM_DEFAULT_DEVICE_ID = "default";

/** What settings keep for a device the user picked. */
export interface SavedDevice {
  /** The id picked; "default" (or nothing) for the system default. */
  readonly deviceId?: string;
  readonly label?: string;
  readonly groupId?: string;
}

/** One entry of the platform's device list for one kind. */
export interface ListedDevice {
  /** Empty while the list is hidden. */
  readonly deviceId: string;
  /** Empty while the list is hidden. */
  readonly label: string;
  readonly groupId?: string;
}

/**
 * Chromium lists "default" and "communications" as aliases of a real
 * endpoint. They never identify a physical device.
 */
export function isVirtualDeviceId(deviceId: string): boolean {
  return deviceId === SYSTEM_DEFAULT_DEVICE_ID || deviceId === "communications";
}

/** A concrete device choice, not the system default. */
export function isSavedDeviceChoice(deviceId: string | undefined): boolean {
  return !!deviceId && deviceId !== SYSTEM_DEFAULT_DEVICE_ID;
}

function normalizedLabel(label: string | undefined): string {
  return label?.trim().toLowerCase() ?? "";
}

/**
 * Windows decorates endpoint names ("Microphone (Shure MV7)"), so one label
 * holding the other counts as the same device. Siblings on one card, like
 * "Line In (Realtek Audio)" and "Microphone (Realtek Audio)", do not overlap.
 */
function labelsOverlap(a: string, b: string): boolean {
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

/**
 * True when the platform lists devices of a kind but hides their ids and
 * labels (no media permission yet). An empty list means none exist.
 */
export function isHiddenDeviceList(devices: readonly ListedDevice[]): boolean {
  return (
    devices.length > 0 &&
    !devices.some((device) => device.deviceId && device.label)
  );
}

export type SavedDeviceMatchKind = "id" | "label" | "groupId";

export interface SavedDeviceMatch<T extends ListedDevice> {
  readonly device: T;
  readonly by: SavedDeviceMatchKind;
}

/**
 * Finds the saved device in a readable list: by id, then by label, then by
 * groupId. On Windows a sound card's Microphone, Line In and Stereo Mix share
 * one groupId, so a group match is accepted only when one physical endpoint
 * has it, or one endpoint in it has an overlapping label. Null for the system
 * default and when the device is not listed. A desktop-native id
 * (`native:…`) is never matched by id: only its label or group can find the
 * endpoint the browser exposes.
 */
export function matchSavedDevice<T extends ListedDevice>(
  candidates: readonly T[],
  saved: SavedDevice,
): SavedDeviceMatch<T> | null {
  const { deviceId, label, groupId } = saved;
  if (!isSavedDeviceChoice(deviceId)) return null;
  if (!deviceId!.startsWith("native:")) {
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
      (groupId && byLabel.find((d) => d.groupId === groupId)) || byLabel[0]!;
    return { device, by: "label" };
  }

  if (groupId) {
    const byGroup = physical.filter((d) => d.groupId === groupId);
    if (byGroup.length === 1) return { device: byGroup[0]!, by: "groupId" };
    const overlapping = byGroup.filter((d) =>
      labelsOverlap(normalizedLabel(d.label), wantedLabel),
    );
    if (overlapping.length === 1) {
      return { device: overlapping[0]!, by: "groupId" };
    }
  }
  return null;
}

/**
 * Where the saved device is in `list` right now, or null when it is not
 * listed (unplugged, the list is hidden, or the choice is the default).
 */
export function listedDeviceId(
  list: readonly ListedDevice[],
  saved: SavedDevice,
): string | null {
  return matchSavedDevice(list, saved)?.device.deviceId ?? null;
}

/**
 * - `default`: nothing concrete is saved; open the system default.
 * - `unverified`: the list is hidden (or cannot be read), so the saved id is
 *   opened as it is, without knowing whether it exists.
 * - `listed`: the saved device is listed (`by` says how it was found).
 * - `missing`: the list is readable and the saved device is not in it; open
 *   the system default.
 */
export type DeviceResolution =
  | { readonly outcome: "default"; readonly deviceId: string | undefined }
  | { readonly outcome: "unverified"; readonly deviceId: string }
  | {
      readonly outcome: "listed";
      readonly deviceId: string;
      readonly by: SavedDeviceMatchKind;
    }
  | { readonly outcome: "missing"; readonly deviceId: "default" };

/**
 * The device to open for `saved`. `list` holds the platform's devices of
 * that kind, or is null when the platform cannot list them at all.
 */
export function resolveSavedDevice(
  saved: SavedDevice,
  list: readonly ListedDevice[] | null,
): DeviceResolution {
  const { deviceId } = saved;
  if (!isSavedDeviceChoice(deviceId)) return { outcome: "default", deviceId };
  if (list === null || isHiddenDeviceList(list)) {
    return { outcome: "unverified", deviceId: deviceId! };
  }
  const match = matchSavedDevice(list, saved);
  if (match) {
    return { outcome: "listed", deviceId: match.device.deviceId, by: match.by };
  }
  return { outcome: "missing", deviceId: SYSTEM_DEFAULT_DEVICE_ID };
}

/** How to ask the platform for a device. */
export interface CaptureTarget {
  readonly deviceId: string | undefined;
  /**
   * Require this device (web: `deviceId: { exact }`). False: let the
   * platform pick its default.
   */
  readonly exact: boolean;
}

/** A concrete id is required exactly; the default is left to the platform. */
export function captureTarget(deviceId: string | undefined): CaptureTarget {
  return isSavedDeviceChoice(deviceId)
    ? { deviceId, exact: true }
    : { deviceId: undefined, exact: false };
}

/**
 * - `retry-system-default`: the exact device could not be opened; open the
 *   system default instead (a fallback capture).
 * - `permission-denied`: surface it; do not retry.
 * - `fail`: anything else; the capture fails.
 */
export type CaptureErrorAction =
  | "retry-system-default"
  | "permission-denied"
  | "fail";

/** What to do when opening a device failed with `errorName`. */
export function captureErrorAction(
  errorName: string | undefined,
): CaptureErrorAction {
  switch (errorName) {
    case "OverconstrainedError":
    case "NotFoundError":
      return "retry-system-default";
    case "NotAllowedError":
      return "permission-denied";
    default:
      return "fail";
  }
}

/**
 * Whether a device opened as `openedId` is the device `wantedId` asks for.
 * The system default (or no id) accepts any device.
 */
export function deviceSatisfies(
  wantedId: string | undefined,
  openedId: string | undefined,
): boolean {
  return !isSavedDeviceChoice(wantedId) || openedId === wantedId;
}

/** A live capture, for the reuse check. */
export interface OpenCapture {
  /** The saved id it was opened for. */
  readonly requestedId: string | undefined;
  /** The device it actually opened (the track's settings). */
  readonly deviceId: string | undefined;
}

/**
 * Whether the live capture `open` still answers a request for the saved id
 * `requestedId`, now resolved as `resolution`. Device only: the platform
 * also checks the track is live and its processing matches.
 *
 * - While the list is hidden, a capture opened for this same saved id
 *   answers it whatever device it got (it may have fallen back): the saved
 *   id cannot be checked against it, so reopening would only repeat it.
 * - A saved device that is now missing resolves to the default, but only a
 *   capture opened for this saved id (and fallen back) answers that; one
 *   opened for another choice is replaced.
 * - Otherwise the capture must be on the resolved device (any device for the
 *   default).
 */
export function captureAnswersRequest(
  requestedId: string | undefined,
  resolution: DeviceResolution,
  open: OpenCapture,
): boolean {
  const sameRequest = open.requestedId === requestedId;
  if (resolution.outcome === "unverified" && sameRequest) return true;
  if (resolution.outcome === "missing" && !sameRequest) return false;
  return deviceSatisfies(resolution.deviceId, open.deviceId);
}

/**
 * What a capture was opened for, kept with its track while it is the
 * session's capture, so a later sync can tell whether anything moved.
 */
export interface CaptureRecord<Track> {
  readonly track: Track;
  /** The saved id then. */
  readonly savedId: string | undefined;
  /** Where the saved device was listed then, or null if it was not. */
  readonly listedId: string | null;
  /** The kind's selection counter then. */
  readonly selection: number;
}

/** The device side of a capture sync for one kind. */
export interface DeviceSyncState<Track> {
  readonly savedId: string | undefined;
  /** {@link listedDeviceId} now. */
  readonly listedId: string | null;
  /** The kind's selection counter now (moves on every pick, even the same). */
  readonly selection: number;
  /** The session's live capture track. */
  readonly track: Track;
  /** The device that track opened. */
  readonly trackDeviceId: string | undefined;
  /** What that track was opened for, if this session recorded it. */
  readonly record: CaptureRecord<Track> | null;
}

/**
 * Whether the live capture is already the device the user wants, so a
 * capture sync keeps it (device only; processing, quality and effects are
 * the platform's checks):
 *
 * - the system default is saved: any device;
 * - the track opened the saved id, or where the saved device is listed now;
 * - the track is a fallback opened for this saved id and nothing moved since:
 *   the saved device is listed as it was (still not, usually) and the user
 *   has not picked a device again.
 */
export function liveCaptureMatches<Track>(
  state: DeviceSyncState<Track>,
): boolean {
  const { savedId, listedId, selection, track, trackDeviceId, record } = state;
  if (deviceSatisfies(savedId, trackDeviceId)) return true;
  if (listedId !== null && trackDeviceId === listedId) return true;
  return (
    !!record &&
    record.track === track &&
    record.savedId === savedId &&
    record.listedId === listedId &&
    record.selection === selection
  );
}

/**
 * The id to save after capture opened `opened` for `saved`, or null to keep
 * the saved choice as it is. Only a refreshed id for the same physical
 * device is saved. A capture that fell back to another device (the saved one
 * is unplugged, or the list was hidden) leaves the choice alone, so the
 * device is used again once it is back. The system default stays "default"
 * and keeps following the OS.
 */
export function deviceToPersist(
  saved: SavedDevice,
  opened: SavedDevice,
): string | null {
  const savedId = saved.deviceId;
  const openedId = opened.deviceId;
  if (!isSavedDeviceChoice(savedId)) return null;
  if (!openedId || openedId === savedId || isVirtualDeviceId(openedId)) {
    return null;
  }
  const savedLabel = normalizedLabel(saved.label);
  const openedLabel = normalizedLabel(opened.label);
  if (savedLabel && savedLabel === openedLabel) return openedId;
  // A shared groupId alone is not enough: sibling inputs of one sound card
  // share it. With both labels known they must overlap as well.
  const sameGroup = !!saved.groupId && saved.groupId === opened.groupId;
  if (!sameGroup) return null;
  if (savedLabel && openedLabel) {
    return labelsOverlap(savedLabel, openedLabel) ? openedId : null;
  }
  return openedId;
}

export interface CaptureOutcome {
  /** {@link deviceToPersist}: write it back with the opened label/groupId. */
  readonly persist: string | null;
  /**
   * The capture is not the saved device: a concrete choice is saved, the
   * capture opened something else, and that is not the saved device under a
   * new id. While true, the platform watches {@link fallbackRetryId}.
   */
  readonly fellBack: boolean;
}

/** What a committed capture means for settings and for later syncs. */
export function captureOutcome(
  saved: SavedDevice,
  opened: SavedDevice,
): CaptureOutcome {
  const persist = deviceToPersist(saved, opened);
  return {
    persist,
    fellBack:
      isSavedDeviceChoice(saved.deviceId) &&
      opened.deviceId !== saved.deviceId &&
      !persist,
  };
}

/**
 * A capture-sync trigger for one kind: while a fallback capture is live, the
 * id the saved device is listed under (null while it is not). It changes
 * when the saved device is plugged back in or the list unlocks, and the sync
 * then reopens it. Without a fallback it is always null, so ordinary list
 * changes do not reopen anything.
 */
export function fallbackRetryId(
  fellBack: boolean,
  listedId: string | null,
): string | null {
  return fellBack ? listedId : null;
}

/** Capture-level processing the platform asks the device for. */
export interface CaptureProcessing {
  readonly noiseSuppression: boolean;
  readonly echoCancellation: boolean;
  readonly autoGainControl: boolean;
}

/** The audio settings that decide the microphone's capture processing. */
export interface CaptureProcessingSettings {
  readonly noiseSuppression: boolean;
  readonly echoCancellation: boolean;
  /** RNNoise (or another in-app denoiser) is on and supported. */
  readonly noiseReductionEnabled: boolean;
  /** The high-fidelity (stereo bypass) profile. */
  readonly streamHighFidelity: boolean;
}

/**
 * What the microphone is opened with. High fidelity turns all three off.
 * Otherwise the platform's own noise suppression is off while an in-app
 * denoiser runs (the two would stack), echo cancellation follows the
 * setting, and automatic gain control is on.
 */
export function captureProcessingFor(
  settings: CaptureProcessingSettings,
): CaptureProcessing {
  if (settings.streamHighFidelity) {
    return {
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
    };
  }
  return {
    noiseSuppression: settings.noiseReductionEnabled
      ? false
      : settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: true,
  };
}

/**
 * Whether a live capture's applied processing is what is wanted. Any
 * difference reopens the device (these are capture constraints, not a
 * processor that can be swapped).
 */
export function captureProcessingMatches(
  applied: Partial<CaptureProcessing>,
  wanted: CaptureProcessing,
): boolean {
  return (
    applied.noiseSuppression === wanted.noiseSuppression &&
    applied.echoCancellation === wanted.echoCancellation &&
    applied.autoGainControl === wanted.autoGainControl
  );
}

/**
 * The speaker to route remote audio to. While the list is hidden (or cannot
 * be read) the saved id is tried as it is; a missing saved speaker routes to
 * the system default; the default stays "default".
 */
export function resolveOutputDevice(
  saved: SavedDevice,
  outputs: readonly ListedDevice[] | null,
): string {
  return (
    resolveSavedDevice(saved, outputs).deviceId ?? SYSTEM_DEFAULT_DEVICE_ID
  );
}

/**
 * Changes whenever an entry of `list` appears, goes or is relabelled (a
 * device plugged in, or the list unlocking after the first capture). Output
 * routing resolves the saved speaker again when it changes.
 */
export function deviceListKey(list: readonly ListedDevice[]): string {
  return list
    .map((d) => `${d.deviceId}|${d.groupId ?? ""}|${d.label}`)
    .join(",");
}
