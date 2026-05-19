import { clog } from "@/lib/console-logger";

const mediaLog = clog("MediaDevices");
// ============================================================================
// useMediaDevices — device enumeration + live audio constraint updates
//
// Uses a module-level Zustand store so ALL consumers share the same device
// state. The useEffect in useMediaDevices() runs exactly once per mount,
// but since it writes to a global store, all readers (UserPanel, VoiceChannel,
// Settings, etc.) see the same hasMicrophone / hasCamera values.
// ============================================================================

import { useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { isDesktop } from "./platform";

export interface MediaDeviceInfo_Custom {
  deviceId: string;
  groupId?: string;
  label: string;
  kind: MediaDeviceKind;
  nativeDeviceId?: string;
  isNative?: boolean;
  isDefault?: boolean;
}

interface MediaDeviceState {
  hasMicrophone: boolean;
  hasCamera: boolean;
  audioInputs: MediaDeviceInfo_Custom[];
  audioOutputs: MediaDeviceInfo_Custom[];
  videoInputs: MediaDeviceInfo_Custom[];
}

// ── Global store — single source of truth for device availability ────────
export const useMediaDeviceStore = create<
  MediaDeviceState & { _update: (partial: Partial<MediaDeviceState>) => void }
>()((set) => ({
  hasMicrophone: false,
  hasCamera: false,
  audioInputs: [],
  audioOutputs: [],
  videoInputs: [],
  _update: (partial) => set(partial),
}));

// ── Eager permission pre-check on module import ─────────────────────────
// 1. Check permissions.query() first — resolves in <5ms, no device lock.
//    If permission is already granted, set hasMicrophone/hasCamera immediately
//    so the UI (mic button, isMicOn, device swap effect) isn't disabled for
//    the ~9 seconds it takes enumerateDevices() to resolve in Firefox with
//    virtual audio drivers.
// 2. Then call enumerateDevices() to populate the full device lists (labels,
//    audioInputs[], etc.) — this may be slow but only blocks device label
//    display, not the basic enabled/disabled state.
if (typeof navigator !== "undefined" && navigator.mediaDevices) {
  // Quick permission check — sets hasMic/hasCam flags synchronously-ish
  if (navigator.permissions?.query) {
    Promise.all([
      navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null),
      navigator.permissions.query({ name: "camera" as PermissionName }).catch(() => null),
    ]).then(([micPerm, camPerm]) => {
      const hasMic = micPerm?.state === "granted";
      const hasCam = camPerm?.state === "granted";
      if (hasMic || hasCam) {
        useMediaDeviceStore.getState()._update({ hasMicrophone: hasMic, hasCamera: hasCam });
      }
    }).catch(() => { /* not supported — fall through to enumerateDevices */ });
  }

  // Full enumerate for device labels — slower but needed for the device picker menus.
  // hasMicrophone/hasCamera may already be true from the permission check above,
  // so this call only blocks device label display, not join/publish flow.
  if (navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const hasMic = devices.some((d) => d.kind === "audioinput");
      const hasCam = devices.some((d) => d.kind === "videoinput");
      useMediaDeviceStore.getState()._update({ hasMicrophone: hasMic, hasCamera: hasCam });
    }).catch(() => { /* ignore — we'll retry on full mount */ });

    // Keep the store current when devices are plugged/unplugged, even before
    // any component mounts useMediaDevices().
    navigator.mediaDevices.addEventListener("devicechange", () => {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const hasMic = devices.some((d) => d.kind === "audioinput");
        const hasCam = devices.some((d) => d.kind === "videoinput");
        useMediaDeviceStore.getState()._update({ hasMicrophone: hasMic, hasCamera: hasCam });
      }).catch(() => { });
    });
  }
}

/** Read-only selector for components that only need hasMicrophone / hasCamera */
export function useDeviceAvailability() {
  return useMediaDeviceStore(useShallow((s) => ({
    hasMicrophone: s.hasMicrophone,
    hasCamera: s.hasCamera,
  })));
}

interface AudioConstraintOptions {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
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

interface NativeAudioDevice {
  device_id: string;
  label: string;
  kind: "audioinput" | "audiooutput";
  is_default: boolean;
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
// ── Module-level dedup: only the first mount triggers full enumeration ───
let _mountCount = 0;
let _cleanup: (() => void) | null = null;

export function useMediaDevices(): MediaDeviceState {
  const store = useMediaDeviceStore();

  useEffect(() => {
    _mountCount++;
    if (_mountCount > 1) return; // already enumerated by another consumer

    const update = useMediaDeviceStore.getState()._update;

    const enumerate = async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          mediaLog.warn("navigator.mediaDevices.enumerateDevices is not supported in this environment");
          update({ hasMicrophone: false, hasCamera: false });
          return;
        }

        // Desktop CEF requires at least one getUserMedia() call
        // before enumerateDevices() returns real, labeled device entries.
        // Without this "prime", the permission gate never opens and devices
        // appear as empty or unlabeled — resulting in "no microphone" errors.
        // The stream is immediately stopped; we only need the side-effect.
        //
        // OPTIMIZATION: Skip the prime if microphone permission is already
        // granted (e.g., from a previous session). This saves ~200-500ms.
        let needsPrime = true;
        try {
          const micPerm = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (micPerm.state === "granted") {
            mediaLog.debug("Microphone permission already granted, skipping prime");
            needsPrime = false;
          }
        } catch {
          // permissions.query not supported — fall through to prime
        }

        if (needsPrime) {
          try {
            mediaLog.debug("Priming getUserMedia({ audio: true })...");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaLog.debug("Prime succeeded, tracks:", stream.getTracks().length);
            stream.getTracks().forEach(t => t.stop());
          } catch (primeErr) {
            mediaLog.warn("getUserMedia prime failed:", primeErr);
            // Permission denied or no device — enumeration below will still
            // work but may return empty labels (which we handle with fallbacks)
          }
        }

        mediaLog.debug("Requesting device list...");
        const devices = await enumerateMediaDevicesWithRetry();
        mediaLog.debug("Raw devices:", JSON.stringify(devices.map(d => ({
          kind: d.kind,
          deviceId: d.deviceId?.substring(0, 12) + "...",
          groupId: d.groupId?.substring(0, 8) + "...",
          label: d.label || "(empty)",
        }))));

        const mics = devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            groupId: d.groupId,
            label: d.label || (d.deviceId === "default" ? "Default Microphone" : `Microphone ${i + 1}`),
            kind: d.kind,
          }));

        const speakers = devices
          .filter((d) => d.kind === "audiooutput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            groupId: d.groupId,
            label: d.label || (d.deviceId === "default" ? "Default Speaker" : `Speaker ${i + 1}`),
            kind: d.kind,
          }));

        const nativeDevices = await getDesktopNativeAudioDevices();
        const resolvedMics = mergeNativeAudioLabels(mics, nativeDevices, "audioinput");
        const resolvedSpeakers = mergeNativeAudioLabels(speakers, nativeDevices, "audiooutput");

        const cams = devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            groupId: d.groupId,
            label: d.label || `Camera ${i + 1}`,
            kind: d.kind,
          }));

        mediaLog.debug("Found counts:", {
          mics: resolvedMics.length,
          cams: cams.length,
          speakers: resolvedSpeakers.length,
          nativeAudioDevices: nativeDevices.length,
          nativeAudioInputs: nativeDevices.filter((device) => device.kind === "audioinput").length,
          nativeAudioOutputs: nativeDevices.filter((device) => device.kind === "audiooutput").length,
        });

        update({
          hasMicrophone: resolvedMics.length > 0,
          hasCamera: cams.length > 0,
          audioInputs: resolvedMics,
          audioOutputs: resolvedSpeakers,
          videoInputs: cams,
        });
      } catch (err) {
        mediaLog.error("Enumeration failed:", err);
        // On error, we default to false to be safe (disable controls)
        update({ hasMicrophone: false, hasCamera: false });
      }
    };

    enumerate();

    // Listen for physical device changes (plug/unplug)
    navigator.mediaDevices?.addEventListener?.("devicechange", enumerate);

    // Listen for permission grants — when the user grants camera/mic
    // permission through the normal join flow, re-enumerate to get
    // full device labels and all devices (especially needed in desktop CEF)
    const permissionCleanups: (() => void)[] = [];
    const watchPermission = async (name: string) => {
      try {
        const status = await navigator.permissions.query({
          name: name as PermissionName,
        });
        const onChange = () => {
          if (status.state === "granted") {
            enumerate();
          }
        };
        status.addEventListener("change", onChange);
        permissionCleanups.push(() =>
          status.removeEventListener("change", onChange)
        );
      } catch {
        // permissions.query not supported for this name — skip
      }
    };
    watchPermission("camera");
    watchPermission("microphone");

    _cleanup = () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", enumerate);
      permissionCleanups.forEach((fn) => fn());
    };

    return () => {
      _mountCount--;
      if (_mountCount === 0 && _cleanup) {
        _cleanup();
        _cleanup = null;
      }
    };
  }, []);

  return {
    hasMicrophone: store.hasMicrophone,
    hasCamera: store.hasCamera,
    audioInputs: store.audioInputs,
    audioOutputs: store.audioOutputs,
    videoInputs: store.videoInputs,
  };
}

/** Apply audio constraints to an existing stream when settings change */
export function useAudioConstraintSync(
  stream: MediaStream | null,
  opts: AudioConstraintOptions
) {
  useEffect(() => {
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack
      .applyConstraints({
        noiseSuppression: opts.noiseSuppression,
        echoCancellation: opts.echoCancellation,
        autoGainControl: opts.autoGainControl,
      })
      .catch((err) => {
        mediaLog.warn("Failed to apply audio constraints:", err);
      });
  }, [stream, opts.noiseSuppression, opts.echoCancellation, opts.autoGainControl]);
}
