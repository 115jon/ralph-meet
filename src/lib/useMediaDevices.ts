// ============================================================================
// useMediaDevices — device enumeration + live audio constraint updates
// ============================================================================

import { useEffect, useState } from "react";

console.log("[useMediaDevices.ts] Module loaded");

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

interface AudioConstraintOptions {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export function useMediaDevices(): MediaDeviceState {
  // console.debug("[MediaDevicesHook] Called");
  const [hasMicrophone, setHasMicrophone] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo_Custom[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo_Custom[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo_Custom[]>([]);

  useEffect(() => {
    // console.debug("[MediaDevicesHook] useEffect triggered");
    const enumerate = async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          console.warn("[MediaDevices] navigator.mediaDevices.enumerateDevices is not supported in this environment");
          setHasMicrophone(false);
          setHasCamera(false);
          return;
        }

        // console.debug("[MediaDevices] Requesting device list...");
        const devices = await navigator.mediaDevices.enumerateDevices();
        // console.debug("[MediaDevices] Raw devices:", devices);

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

        // console.debug("[MediaDevices] Found counts:", { mics: mics.length, cams: cams.length, speakers: speakers.length });

        setHasMicrophone(mics.length > 0);
        setHasCamera(cams.length > 0);
        setAudioInputs(mics);
        setAudioOutputs(speakers);
        setVideoInputs(cams);
      } catch (err) {
        console.error("[MediaDevices] Enumeration failed:", err);
        // On error, we default to false to be safe (disable controls)
        setHasMicrophone(false);
        setHasCamera(false);
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

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", enumerate);
      permissionCleanups.forEach((fn) => fn());
    };
  }, []);

  return { hasMicrophone, hasCamera, audioInputs, audioOutputs, videoInputs };
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
