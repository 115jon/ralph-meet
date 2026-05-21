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
import {
  getMediaDeviceSnapshot,
  type MediaDeviceInfo_Custom,
} from "@/lib/media-device-snapshot";
export type { MediaDeviceInfo_Custom } from "@/lib/media-device-snapshot";

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

        mediaLog.debug("Requesting device list...");
        const snapshot = await getMediaDeviceSnapshot();
        mediaLog.debug("Raw devices:", JSON.stringify(snapshot.rawDevices.map(d => ({
          kind: d.kind,
          deviceId: d.deviceId?.substring(0, 12) + "...",
          groupId: d.groupId?.substring(0, 8) + "...",
          label: d.label || "(empty)",
        }))));

        mediaLog.debug("Found counts:", {
          mics: snapshot.audioInputs.length,
          cams: snapshot.videoInputs.length,
          speakers: snapshot.audioOutputs.length,
          nativeAudioDevices: snapshot.nativeAudioDevices.length,
          nativeAudioInputs: snapshot.nativeAudioDevices.filter((device) => device.kind === "audioinput").length,
          nativeAudioOutputs: snapshot.nativeAudioDevices.filter((device) => device.kind === "audiooutput").length,
        });

        update({
          hasMicrophone: snapshot.audioInputs.length > 0,
          hasCamera: snapshot.videoInputs.length > 0,
          audioInputs: snapshot.audioInputs,
          audioOutputs: snapshot.audioOutputs,
          videoInputs: snapshot.videoInputs,
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
