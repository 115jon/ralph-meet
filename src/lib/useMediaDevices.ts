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

export interface MediaDeviceInfo_Custom {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

interface MediaDeviceState {
  hasMicrophone: boolean;
  hasCamera: boolean;
  audioInputs: MediaDeviceInfo_Custom[];
  audioOutputs: MediaDeviceInfo_Custom[];
  videoInputs: MediaDeviceInfo_Custom[];
}

// ── Global store — single source of truth for device availability ────────
const useMediaDeviceStore = create<
  MediaDeviceState & { _update: (partial: Partial<MediaDeviceState>) => void }
>()((set) => ({
  hasMicrophone: false,
  hasCamera: false,
  audioInputs: [],
  audioOutputs: [],
  videoInputs: [],
  _update: (partial) => set(partial),
}));

// ── Eager lightweight enumeration on module import ──────────────────────
// Runs enumerateDevices() immediately (no getUserMedia → no permission prompt).
// Device labels will be empty until permission is granted, but hasMicrophone /
// hasCamera will be correct. The full enumeration (with labels + getUserMedia
// prime) runs when useMediaDevices() is first mounted.
if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
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
          console.warn("[MediaDevices] navigator.mediaDevices.enumerateDevices is not supported in this environment");
          update({ hasMicrophone: false, hasCamera: false });
          return;
        }

        // WebView2 (Tauri / desktop) requires at least one getUserMedia() call
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
            console.debug("[MediaDevices] Microphone permission already granted, skipping prime");
            needsPrime = false;
          }
        } catch {
          // permissions.query not supported — fall through to prime
        }

        if (needsPrime) {
          try {
            console.debug("[MediaDevices] Priming getUserMedia({ audio: true })...");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.debug("[MediaDevices] Prime succeeded, tracks:", stream.getTracks().length);
            stream.getTracks().forEach(t => t.stop());
          } catch (primeErr) {
            console.warn("[MediaDevices] getUserMedia prime failed:", primeErr);
            // Permission denied or no device — enumeration below will still
            // work but may return empty labels (which we handle with fallbacks)
          }
        }

        console.debug("[MediaDevices] Requesting device list...");
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.debug("[MediaDevices] Raw devices:", JSON.stringify(devices.map(d => ({
          kind: d.kind,
          deviceId: d.deviceId?.substring(0, 12) + "...",
          label: d.label || "(empty)",
          groupId: d.groupId?.substring(0, 8) + "...",
        }))));

        const mics = devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${i + 1}`,
            kind: d.kind,
          }));

        const speakers = devices
          .filter((d) => d.kind === "audiooutput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Speaker ${i + 1}`,
            kind: d.kind,
          }));

        const cams = devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
            kind: d.kind,
          }));

        console.debug("[MediaDevices] Found counts:", { mics: mics.length, cams: cams.length, speakers: speakers.length });

        update({
          hasMicrophone: mics.length > 0,
          hasCamera: cams.length > 0,
          audioInputs: mics,
          audioOutputs: speakers,
          videoInputs: cams,
        });
      } catch (err) {
        console.error("[MediaDevices] Enumeration failed:", err);
        // On error, we default to false to be safe (disable controls)
        update({ hasMicrophone: false, hasCamera: false });
      }
    };

    enumerate();

    // Listen for physical device changes (plug/unplug)
    navigator.mediaDevices?.addEventListener?.("devicechange", enumerate);

    // Listen for permission grants — when the user grants camera/mic
    // permission through the normal join flow, re-enumerate to get
    // full device labels and all devices (especially needed on Firefox)
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
        console.warn("[MediaDevices] Failed to apply audio constraints:", err);
      });
  }, [stream, opts.noiseSuppression, opts.echoCancellation, opts.autoGainControl]);
}
