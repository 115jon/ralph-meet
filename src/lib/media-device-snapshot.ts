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

export interface NativeAudioDevice {
  device_id: string;
  label: string;
  kind: "audioinput" | "audiooutput";
  is_default: boolean;
}

export interface MediaDeviceSnapshot {
  audioInputs: MediaDeviceInfo_Custom[];
  audioOutputs: MediaDeviceInfo_Custom[];
  videoInputs: MediaDeviceInfo_Custom[];
  nativeAudioDevices: NativeAudioDevice[];
  rawDevices: MediaDeviceInfo[];
}

const DEVICE_ENUMERATION_ATTEMPTS = 6;
const DEVICE_ENUMERATION_RETRY_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hasUsefulDeviceLabels(devices: MediaDeviceInfo[]) {
  return devices.some((d) => (
    (d.kind === "audioinput" || d.kind === "audiooutput") &&
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

function nativeAudioDeviceCount(devices: NativeAudioDevice[], kind: "audioinput" | "audiooutput") {
  return devices.filter((device) => device.kind === kind && !device.is_default).length;
}

function hasCompleteDesktopAudioDeviceList(
  browserDevices: MediaDeviceInfo[],
  nativeDevices: NativeAudioDevice[],
) {
  if (!hasUsefulDeviceLabels(browserDevices)) return false;

  const nativeInputCount = nativeAudioDeviceCount(nativeDevices, "audioinput");
  const nativeOutputCount = nativeAudioDeviceCount(nativeDevices, "audiooutput");
  const browserInputCount = browserAudioDeviceCount(browserDevices, "audioinput");
  const browserOutputCount = browserAudioDeviceCount(browserDevices, "audiooutput");

  return (
    (nativeInputCount === 0 || browserInputCount >= nativeInputCount) &&
    (nativeOutputCount === 0 || browserOutputCount >= nativeOutputCount)
  );
}

async function primeAudioDeviceAccess() {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });
  stream.getTracks().forEach((track) => track.stop());
}

export async function getDesktopNativeAudioDevices(): Promise<NativeAudioDevice[]> {
  if (!isDesktop()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeAudioDevice[]>("get_native_audio_devices");
  } catch (err) {
    mediaLog.warn("Native audio device enumeration failed:", err);
    return [];
  }
}

export async function enumerateMediaDevicesWithRetry() {
  let lastDevices: MediaDeviceInfo[] = [];
  const attempts = isDesktop() ? DEVICE_ENUMERATION_ATTEMPTS : 2;
  const nativeDevices = isDesktop() ? await getDesktopNativeAudioDevices() : [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt === 1 || isDesktop()) {
      try {
        mediaLog.debug("Priming getUserMedia({ audio: true }) before device enumeration", { attempt });
        await primeAudioDeviceAccess();
      } catch (primeErr) {
        mediaLog.warn("getUserMedia prime failed:", primeErr);
      }
    }

    lastDevices = await navigator.mediaDevices.enumerateDevices();

    if (!isDesktop() || hasCompleteDesktopAudioDeviceList(lastDevices, nativeDevices)) {
      return lastDevices;
    }

    mediaLog.debug("Desktop device list not ready yet; retrying enumeration", {
      attempt,
      browserInputs: browserAudioDeviceCount(lastDevices, "audioinput"),
      browserOutputs: browserAudioDeviceCount(lastDevices, "audiooutput"),
      nativeInputs: nativeAudioDeviceCount(nativeDevices, "audioinput"),
      nativeOutputs: nativeAudioDeviceCount(nativeDevices, "audiooutput"),
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
  nativeDevices: NativeAudioDevice[],
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
  const nativeAudioDevices = await getDesktopNativeAudioDevices();

  return {
    rawDevices,
    nativeAudioDevices,
    audioInputs: mergeNativeAudioLabels(audioInputs, nativeAudioDevices, "audioinput"),
    audioOutputs: mergeNativeAudioLabels(audioOutputs, nativeAudioDevices, "audiooutput"),
    videoInputs,
  };
}
