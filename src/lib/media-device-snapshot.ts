import { clog } from "@/lib/console-logger";
import { isDesktop } from "@/lib/platform";

const mediaLog = clog("MediaDevices");

export interface MediaDeviceInfo_Custom {
  deviceId: string;
  groupId?: string;
  label: string;
  kind: MediaDeviceKind;
  nativeDeviceId?: string;
  isNative?: boolean;
  isDefault?: boolean;
}

export interface NativeDevice {
  device_id: string;
  label: string;
  kind: "audioinput" | "audiooutput" | "videoinput";
  is_default: boolean;
}

export type NativeAudioDevice = NativeDevice;

export interface MediaDeviceSnapshot {
  audioInputs: MediaDeviceInfo_Custom[];
  audioOutputs: MediaDeviceInfo_Custom[];
  videoInputs: MediaDeviceInfo_Custom[];
  nativeAudioDevices: NativeDevice[];
  nativeVideoDevices: NativeDevice[];
  rawDevices: MediaDeviceInfo[];
}

const DEVICE_ENUMERATION_ATTEMPTS = 6;
const DEVICE_ENUMERATION_RETRY_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hasUsefulDeviceLabels(devices: MediaDeviceInfo[]) {
  return devices.some((d) => (
    d.deviceId !== "default" &&
    d.deviceId !== "communications" &&
    d.label.trim().length > 0
  ));
}

function browserAudioDeviceCount(devices: MediaDeviceInfo[], kind: "audioinput" | "audiooutput") {
  return devices.filter((device) => (
    device.kind === kind &&
    device.deviceId !== "default" &&
    device.deviceId !== "communications" &&
    device.label.trim().length > 0
  )).length;
}

function nativeAudioDeviceCount(devices: NativeDevice[], kind: "audioinput" | "audiooutput") {
  return devices.filter((device) => device.kind === kind && !device.is_default).length;
}

function hasCompleteDesktopDeviceList(
  browserDevices: MediaDeviceInfo[],
  nativeAudioDevices: NativeDevice[],
  nativeVideoDevices: NativeDevice[],
) {
  if (!hasUsefulDeviceLabels(browserDevices)) return false;

  const nativeInputCount = nativeAudioDeviceCount(nativeAudioDevices, "audioinput");
  const nativeOutputCount = nativeAudioDeviceCount(nativeAudioDevices, "audiooutput");
  const browserInputCount = browserAudioDeviceCount(browserDevices, "audioinput");
  const browserOutputCount = browserAudioDeviceCount(browserDevices, "audiooutput");

  const audioComplete =
    (nativeInputCount === 0 || browserInputCount >= nativeInputCount) &&
    (nativeOutputCount === 0 || browserOutputCount >= nativeOutputCount);

  const nativeVideoCount = nativeVideoDevices.filter((d) => d.kind === "videoinput").length;
  const browserVideoCount = browserDevices.filter((d) => d.kind === "videoinput" && d.label.trim().length > 0).length;

  const videoComplete = nativeVideoCount === 0 || browserVideoCount >= nativeVideoCount;

  return audioComplete && videoComplete;
}

async function primeAudioDeviceAccess() {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });
  stream.getTracks().forEach((track) => track.stop());
}

async function primeVideoDeviceAccess() {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: true,
  });
  stream.getTracks().forEach((track) => track.stop());
}

export async function getDesktopNativeAudioDevices(): Promise<NativeDevice[]> {
  if (!isDesktop()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeDevice[]>("get_native_audio_devices");
  } catch (err) {
    mediaLog.warn("Native audio device enumeration failed:", err);
    return [];
  }
}

export async function getDesktopNativeVideoDevices(): Promise<NativeDevice[]> {
  if (!isDesktop()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeDevice[]>("get_native_video_devices");
  } catch (err) {
    mediaLog.warn("Native video device enumeration failed:", err);
    return [];
  }
}

export async function enumerateMediaDevicesWithRetry() {
  let lastDevices: MediaDeviceInfo[] = [];
  const attempts = isDesktop() ? DEVICE_ENUMERATION_ATTEMPTS : 2;
  const [nativeAudioDevices, nativeVideoDevices] = isDesktop()
    ? await Promise.all([getDesktopNativeAudioDevices(), getDesktopNativeVideoDevices()])
    : [[], []];

  const hasNativeVideo = nativeVideoDevices.some((d) => d.kind === "videoinput");

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt === 1 || isDesktop()) {
      try {
        mediaLog.debug("Priming getUserMedia({ audio: true }) before device enumeration", { attempt });
        await primeAudioDeviceAccess();
      } catch (primeErr) {
        mediaLog.warn("getUserMedia audio prime failed:", primeErr);
      }

      if (isDesktop() && hasNativeVideo) {
        try {
          mediaLog.debug("Priming getUserMedia({ video: true }) before device enumeration", { attempt });
          await primeVideoDeviceAccess();
        } catch (primeErr) {
          mediaLog.warn("getUserMedia video prime failed:", primeErr);
        }
      }
    }

    lastDevices = await navigator.mediaDevices.enumerateDevices();

    if (!isDesktop() || hasCompleteDesktopDeviceList(lastDevices, nativeAudioDevices, nativeVideoDevices)) {
      return lastDevices;
    }

    mediaLog.debug("Desktop device list not ready yet; retrying enumeration", {
      attempt,
      browserAudioInputs: browserAudioDeviceCount(lastDevices, "audioinput"),
      browserAudioOutputs: browserAudioDeviceCount(lastDevices, "audiooutput"),
      browserVideoInputs: lastDevices.filter((d) => d.kind === "videoinput" && d.label.trim().length > 0).length,
      nativeAudioInputs: nativeAudioDeviceCount(nativeAudioDevices, "audioinput"),
      nativeAudioOutputs: nativeAudioDeviceCount(nativeAudioDevices, "audiooutput"),
      nativeVideoInputs: nativeVideoDevices.filter((d) => d.kind === "videoinput").length,
      devices: lastDevices.map((d) => ({ kind: d.kind, label: d.label || "(empty)" })),
    });
    await sleep(DEVICE_ENUMERATION_RETRY_MS);
  }

  return lastDevices;
}

function hasBrowserGeneratedLabel(device: MediaDeviceInfo_Custom, index: number) {
  const fallbackName = device.kind === "audioinput" ? `Microphone ${index + 1}` : `Speaker ${index + 1}`;
  return device.label.trim().length === 0 || device.label === fallbackName;
}

function normalizedDeviceLabel(label: string) {
  return label.trim().toLowerCase();
}

export function mergeNativeAudioLabels(
  browserDevices: MediaDeviceInfo_Custom[],
  nativeDevices: NativeDevice[],
  kind: "audioinput" | "audiooutput",
): MediaDeviceInfo_Custom[] {
  const matchingNativeDevices = nativeDevices
    .filter((device) => device.kind === kind)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default));

  if (matchingNativeDevices.length === 0) return browserDevices;

  const defaultNativeDevice = matchingNativeDevices.find((device) => device.is_default);
  const nonDefaultNativeDevices = matchingNativeDevices.filter((device) => !device.is_default);
  const usedNativeIds = new Set<string>();
  let nonDefaultIndex = 0;

  const mergedBrowserDevices = browserDevices.map((device, index) => {
    if (device.deviceId === "default") {
      if (defaultNativeDevice) {
        usedNativeIds.add(defaultNativeDevice.device_id);
      }
      return {
        ...device,
        label: defaultNativeDevice?.label || device.label,
        isDefault: true,
        isNative: Boolean(defaultNativeDevice),
      };
    }

    if (!hasBrowserGeneratedLabel(device, index)) {
      const nativeMatch = matchingNativeDevices.find(
        (nativeDevice) => normalizedDeviceLabel(nativeDevice.label) === normalizedDeviceLabel(device.label)
      );
      if (nativeMatch) {
        usedNativeIds.add(nativeMatch.device_id);
        return {
          ...device,
          nativeDeviceId: nativeMatch.device_id,
          isNative: true,
          isDefault: nativeMatch.is_default,
        };
      }
      return device;
    }

    const nativeDevice = nonDefaultNativeDevices[nonDefaultIndex] ?? matchingNativeDevices[nonDefaultIndex];
    nonDefaultIndex++;

    if (!nativeDevice?.label) return device;

    return {
      ...device,
      label: nativeDevice.label,
      nativeDeviceId: nativeDevice.device_id,
      isNative: true,
      isDefault: nativeDevice.is_default,
    };
  });

  const hiddenNativeCount = matchingNativeDevices.length - usedNativeIds.size;
  if (hiddenNativeCount > 0) {
    mediaLog.debug("Native devices not exposed by CEF/WebRTC were hidden from selectable list", {
      kind,
      hiddenNativeCount,
      browserDeviceCount: browserDevices.length,
      nativeDeviceCount: matchingNativeDevices.length,
    });
  }

  return mergedBrowserDevices;
}

export function mergeNativeVideoLabels(
  browserDevices: MediaDeviceInfo_Custom[],
  nativeDevices: NativeDevice[],
): MediaDeviceInfo_Custom[] {
  const matchingNativeDevices = nativeDevices
    .filter((device) => device.kind === "videoinput");

  if (matchingNativeDevices.length === 0) return browserDevices;

  const usedNativeIds = new Set<string>();
  let cameraIndex = 0;

  const mergedBrowserDevices = browserDevices.map((device, index) => {
    // If we have a useful browser-provided label, try to match by name
    if (device.label.trim().length > 0 && device.label !== `Camera ${index + 1}`) {
      const nativeMatch = matchingNativeDevices.find(
        (nativeDevice) => normalizedDeviceLabel(nativeDevice.label) === normalizedDeviceLabel(device.label)
      );
      if (nativeMatch) {
        usedNativeIds.add(nativeMatch.device_id);
        return {
          ...device,
          nativeDeviceId: nativeMatch.device_id,
          isNative: true,
        };
      }
      return device;
    }

    // Otherwise, assign sequentially from the native list
    const nativeDevice = matchingNativeDevices[cameraIndex];
    if (nativeDevice) {
      cameraIndex++;
      usedNativeIds.add(nativeDevice.device_id);
      return {
        ...device,
        label: nativeDevice.label,
        nativeDeviceId: nativeDevice.device_id,
        isNative: true,
      };
    }

    return device;
  });

  const hiddenNativeCount = matchingNativeDevices.length - usedNativeIds.size;
  if (hiddenNativeCount > 0) {
    mediaLog.debug("Native video devices not exposed by CEF/WebRTC were hidden from selectable list", {
      hiddenNativeCount,
      browserDeviceCount: browserDevices.length,
      nativeDeviceCount: matchingNativeDevices.length,
    });
  }

  return mergedBrowserDevices;
}

export async function getMediaDeviceSnapshot(): Promise<MediaDeviceSnapshot> {
  const rawDevices = await enumerateMediaDevicesWithRetry();
  const audioInputs = rawDevices
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      groupId: d.groupId,
      label: d.label || (d.deviceId === "default" ? "Default Microphone" : `Microphone ${i + 1}`),
      kind: d.kind,
    }));
  const audioOutputs = rawDevices
    .filter((d) => d.kind === "audiooutput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      groupId: d.groupId,
      label: d.label || (d.deviceId === "default" ? "Default Speaker" : `Speaker ${i + 1}`),
      kind: d.kind,
    }));
  const videoInputs = rawDevices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      groupId: d.groupId,
      label: d.label || `Camera ${i + 1}`,
      kind: d.kind,
    }));

  const [nativeAudioDevices, nativeVideoDevices] = await Promise.all([
    getDesktopNativeAudioDevices(),
    getDesktopNativeVideoDevices(),
  ]);

  return {
    rawDevices,
    nativeAudioDevices,
    nativeVideoDevices,
    audioInputs: mergeNativeAudioLabels(audioInputs, nativeAudioDevices, "audioinput"),
    audioOutputs: mergeNativeAudioLabels(audioOutputs, nativeAudioDevices, "audiooutput"),
    videoInputs: mergeNativeVideoLabels(videoInputs, nativeVideoDevices),
  };
}
