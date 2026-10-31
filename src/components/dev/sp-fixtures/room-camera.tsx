/**
 * Room settings and camera settings fixtures.
 *
 *   sp-room / sp-room-camera / sp-room-appearance   room settings pages
 *   sp-camera          camera modal with a live (canvas) stream
 *   sp-camera-loading  camera modal while the camera is starting
 *   sp-camera-denied   camera permission denied
 *   sp-camera-none     no camera plugged in
 *   sp-voice             Studio voice page with labeled devices
 *   sp-voice-permission  Studio voice page before mic access (unlabeled mics)
 *   sp-voice-loading     Studio voice page while devices are listed
 *   sp-voice-none        Studio voice page with no microphone
 */

import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import RoomSettingsModal, {
  type RoomSettingsTab,
} from "@/components/RoomSettingsModal";
import SettingsModal from "@/components/chat/SettingsModal";
import { useState, type ReactNode } from "react";
import { ok, useApiStub } from "./api-stub";

const ROOM_CAMERA_SURFACES = [
  "sp-room",
  "sp-room-camera",
  "sp-room-appearance",
  "sp-camera",
  "sp-camera-loading",
  "sp-camera-denied",
  "sp-camera-none",
  "sp-voice",
  "sp-voice-permission",
  "sp-voice-loading",
  "sp-voice-none",
];

/**
 * live      labeled mic, speaker and two cameras; capture works
 * loading   capture never resolves (the preview spinner)
 * denied    the camera is listed unlabeled and capture is refused
 * none      no camera at all
 * locked    every device unlabeled until audio capture is allowed
 * scanning  the device list never comes back
 * nomic     no microphone at all
 */
type CameraMode =
  | "live"
  | "loading"
  | "denied"
  | "none"
  | "locked"
  | "scanning"
  | "nomic";

const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
  ({
    kind,
    deviceId,
    label,
    groupId: `g-${deviceId}`,
    toJSON: () => ({}),
  }) as MediaDeviceInfo;

/** A moving gradient so the preview reads as live video in a screenshot. */
function canvasStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  let t = 0;
  const draw = () => {
    if (!ctx) return;
    const g = ctx.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, `hsl(${(t * 2) % 360} 45% 35%)`); // ds-allow:raw-color fake camera frame drawn on a canvas
    g.addColorStop(1, `hsl(${(t * 2 + 120) % 360} 45% 22%)`); // ds-allow:raw-color fake camera frame drawn on a canvas
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(320, 170, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(210, 260, 220, 120);
    t += 1;
  };
  draw();
  const timer = window.setInterval(draw, 120);
  const stream = canvas.captureStream(10);
  stream.getTracks().forEach((track) => {
    const stop = track.stop.bind(track);
    track.stop = () => {
      window.clearInterval(timer);
      stop();
    };
  });
  return stream;
}

/** Point navigator.mediaDevices at a fake set of devices for one state. */
function useFixtureCamera(mode: CameraMode) {
  useState(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return 0;
    const media = navigator.mediaDevices;
    let granted = mode !== "locked";
    const label = (name: string) => (granted ? name : "");
    const list = (): MediaDeviceInfo[] => {
      const devices: MediaDeviceInfo[] = [];
      if (mode !== "nomic") {
        devices.push(device("audioinput", "mic-1", label("Studio Mic (USB)")));
      }
      devices.push(device("audiooutput", "out-1", label("Desk Speakers")));
      if (mode === "none") return devices;
      devices.push(
        device(
          "videoinput",
          "cam-1",
          mode === "denied" ? "" : label("FaceTime HD Camera"),
        ),
      );
      if (mode === "live" || mode === "loading") {
        devices.push(device("videoinput", "cam-2", "Logitech Brio 4K"));
      }
      return devices;
    };
    media.enumerateDevices = () =>
      mode === "scanning"
        ? new Promise<MediaDeviceInfo[]>(() => {})
        : Promise.resolve(list());
    if (mode === "denied" && navigator.permissions?.query) {
      // A refused camera reads "denied" in the Permissions API too.
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor) =>
        descriptor.name === ("camera" as PermissionName)
          ? Promise.resolve({
              state: "denied",
              addEventListener() {},
              removeEventListener() {},
            } as unknown as PermissionStatus)
          : query(descriptor);
    }
    media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      if (constraints?.video) {
        if (mode === "loading") return new Promise<MediaStream>(() => {});
        if (mode === "denied") {
          throw new DOMException("Permission denied", "NotAllowedError");
        }
        if (mode === "none") {
          throw new DOMException("Requested device not found", "NotFoundError");
        }
        return canvasStream();
      }
      if (mode === "nomic") {
        throw new DOMException("Requested device not found", "NotFoundError");
      }
      granted = true;
      return new MediaStream();
    };
    return 0;
  });
}

const backgroundsRoute = {
  path: /^\/api\/camera-backgrounds$/,
  reply: () => ok({ backgrounds: [] }),
};

function CameraFixture({ mode }: { mode: CameraMode }) {
  useFixtureCamera(mode);
  useApiStub([backgroundsRoute]);
  return (
    <CameraSettingsModal
      isOpen
      onClose={() => {}}
      isCameraActive={false}
      onToggleCamera={() => {}}
      settingsUserId="u-me"
    />
  );
}

function RoomFixture({ surface }: { surface: string }) {
  useFixtureCamera("live");
  useApiStub([backgroundsRoute]);
  const initialTab: RoomSettingsTab =
    surface === "sp-room-camera"
      ? "camera"
      : surface === "sp-room-appearance"
        ? "appearance"
        : "voice";
  return (
    <RoomSettingsModal
      open
      onClose={() => {}}
      settingsUserId="room-fixture"
      initialTab={initialTab}
    />
  );
}

function VoiceFixture({ mode }: { mode: CameraMode }) {
  useFixtureCamera(mode);
  useApiStub([backgroundsRoute]);
  return <SettingsModal open onClose={() => {}} initialTab="voice" />;
}

const MODE_BY_SURFACE: Record<string, CameraMode> = {
  "sp-camera": "live",
  "sp-camera-loading": "loading",
  "sp-camera-denied": "denied",
  "sp-camera-none": "none",
  "sp-voice-permission": "locked",
  "sp-voice-loading": "scanning",
  "sp-voice-none": "nomic",
};

export function renderRoomCameraFixture(
  surface: string,
  shell: ReactNode,
): ReactNode | null {
  if (!ROOM_CAMERA_SURFACES.includes(surface)) return null;
  const mode = MODE_BY_SURFACE[surface] ?? "live";
  const body = surface.startsWith("sp-room") ? (
    <RoomFixture surface={surface} />
  ) : surface.startsWith("sp-voice") ? (
    <VoiceFixture mode={mode} />
  ) : (
    <CameraFixture mode={mode} />
  );
  return (
    <div className="relative h-full w-full">
      {shell}
      {body}
    </div>
  );
}
