/**
 * What a settings page can say about a kind of media device:
 *
 *   loading   the first scan has not come back yet
 *   none      the browser lists no device of this kind
 *   locked    devices exist but come back unlabeled (no permission yet)
 *   ready     labeled devices, the pickers can show real names
 *
 * `request()` asks for access once (getUserMedia), stops the tracks at once
 * and scans again, so the pickers fill in with real names. Raw browser error
 * text never reaches the screen; `describeMediaError` picks the copy.
 */

import { getMediaDeviceSnapshot } from "@/lib/media-device-snapshot";
import { useMediaDeviceStore } from "@/lib/useMediaDevices";
import { useCallback, useEffect, useRef, useState } from "react";

export type DeviceAccessStatus = "loading" | "none" | "locked" | "ready";
export type MediaKind = "audioinput" | "videoinput";

export type MediaErrorKind = "denied" | "missing" | "busy" | "unknown";

/** Sort a getUserMedia failure into something the UI can explain. */
export function classifyMediaError(error: unknown): MediaErrorKind {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "missing";
  }
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "unknown";
}

const NOUN: Record<MediaKind, { device: string; access: string }> = {
  audioinput: { device: "microphone", access: "Microphone" },
  videoinput: { device: "camera", access: "Camera" },
};

/** One-line copy for a failed access request, by kind of device. */
export function describeMediaError(error: unknown, kind: MediaKind): string {
  return describeMediaProblem(classifyMediaError(error), kind);
}

export function describeMediaProblem(
  problem: MediaErrorKind,
  kind: MediaKind,
): string {
  const { device, access } = NOUN[kind];
  switch (problem) {
    case "denied":
      return `${access} access is off. Allow it from the lock icon in your browser's address bar, then try again.`;
    case "missing":
      return `No ${device} found. Plug one in, then try again.`;
    case "busy":
      return `Your ${device} is in use by another app. Close that app, then try again.`;
    default:
      return `Unable to reach your ${device}. Try again.`;
  }
}

function statusFrom(devices: MediaDeviceInfo[], kind: MediaKind) {
  const ofKind = devices.filter((device) => device.kind === kind);
  if (ofKind.length === 0) return "none" as const;
  return ofKind.some((device) => device.label.trim().length > 0)
    ? ("ready" as const)
    : ("locked" as const);
}

export function useDeviceAccess(kind: MediaKind) {
  const [status, setStatus] = useState<DeviceAccessStatus>("loading");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const rescan = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      if (mounted.current) setStatus("none");
      return;
    }
    try {
      const snapshot = await getMediaDeviceSnapshot();
      // Share the fresh lists with every picker in the app.
      useMediaDeviceStore.getState()._update({
        hasMicrophone: snapshot.audioInputs.length > 0,
        hasCamera: snapshot.videoInputs.length > 0,
        audioInputs: snapshot.audioInputs,
        audioOutputs: snapshot.audioOutputs,
        videoInputs: snapshot.videoInputs,
      });
      if (mounted.current) setStatus(statusFrom(snapshot.rawDevices, kind));
    } catch {
      if (mounted.current) setStatus("none");
    }
  }, [kind]);

  useEffect(() => {
    mounted.current = true;
    void rescan();
    const media =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const onChange = () => void rescan();
    media?.addEventListener?.("devicechange", onChange);
    return () => {
      mounted.current = false;
      media?.removeEventListener?.("devicechange", onChange);
    };
  }, [rescan]);

  const request = useCallback(async () => {
    setRequesting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "audioinput" ? { audio: true } : { video: true },
      );
      stream.getTracks().forEach((track) => track.stop());
      await rescan();
    } catch (err) {
      if (mounted.current) {
        setError(describeMediaError(err, kind));
        if (classifyMediaError(err) === "missing") setStatus("none");
      }
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }, [kind, rescan]);

  return { status, requesting, error, request, rescan };
}
