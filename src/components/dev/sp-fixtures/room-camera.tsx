/**
 * Room settings and camera settings fixtures.
 *
 *   sp-room / sp-room-camera / sp-room-appearance   room settings pages
 *   sp-camera          camera modal with a live (canvas) stream
 *   sp-camera-denied   camera permission denied
 *   sp-camera-none     no camera plugged in
 */

import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import RoomSettingsModal from "@/components/RoomSettingsModal";
import { useState, type ReactNode } from "react";
import { ok, useApiStub } from "./api-stub";

export const ROOM_CAMERA_SURFACES = [
  "sp-room",
  "sp-room-camera",
  "sp-room-appearance",
  "sp-camera",
  "sp-camera-denied",
  "sp-camera-none",
];

type CameraMode = "live" | "denied" | "none";

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
    g.addColorStop(0, `hsl(${(t * 2) % 360} 45% 35%)`);
    g.addColorStop(1, `hsl(${(t * 2 + 120) % 360} 45% 22%)`);
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

/** Point navigator.mediaDevices at a fake camera (or none, or a refusal). */
export function useFixtureCamera(mode: CameraMode) {
  useState(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return 0;
    const media = navigator.mediaDevices;
    const devices: MediaDeviceInfo[] = [
      device("audioinput", "mic-1", "Studio Mic (USB)"),
      device("audiooutput", "out-1", "Desk Speakers"),
    ];
    if (mode !== "none") {
      devices.push(
        device(
          "videoinput",
          "cam-1",
          mode === "denied" ? "" : "FaceTime HD Camera",
        ),
      );
      if (mode === "live") {
        devices.push(device("videoinput", "cam-2", "Logitech Brio 4K"));
      }
    }
    media.enumerateDevices = () => Promise.resolve(devices);
    media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      if (constraints?.video) {
        if (mode === "denied") {
          throw new DOMException("Permission denied", "NotAllowedError");
        }
        if (mode === "none") {
          throw new DOMException("Requested device not found", "NotFoundError");
        }
        return canvasStream();
      }
      return new MediaStream();
    };
    return 0;
  });
}

function CameraFixture({ mode }: { mode: CameraMode }) {
  useFixtureCamera(mode);
  useApiStub([
    {
      path: /^\/api\/camera-backgrounds$/,
      reply: () => ok({ backgrounds: [] }),
    },
  ]);
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
  useApiStub([
    {
      path: /^\/api\/camera-backgrounds$/,
      reply: () => ok({ backgrounds: [] }),
    },
  ]);
  // Read by the rebuilt modal; older builds ignore it.
  const extra = {
    initialTab:
      surface === "sp-room-camera"
        ? "camera"
        : surface === "sp-room-appearance"
          ? "appearance"
          : "voice",
  } as object;
  return (
    <RoomSettingsModal
      open
      onClose={() => {}}
      settingsUserId="u-me"
      {...extra}
    />
  );
}

export function renderRoomCameraFixture(
  surface: string,
  shell: ReactNode,
): ReactNode | null {
  if (!ROOM_CAMERA_SURFACES.includes(surface)) return null;
  const body = surface.startsWith("sp-room") ? (
    <RoomFixture surface={surface} />
  ) : (
    <CameraFixture
      mode={
        surface === "sp-camera-denied"
          ? "denied"
          : surface === "sp-camera-none"
            ? "none"
            : "live"
      }
    />
  );
  return (
    <div className="relative h-full w-full">
      {shell}
      {body}
    </div>
  );
}
