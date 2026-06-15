export type CameraQualityId = "480p30" | "720p30" | "720p60" | "1080p30" | "1080p60";

export interface CameraQualityProfile {
  id: CameraQualityId;
  label: string;
  width: number;
  height: number;
  fps: number;
  description: string;
}

export const DEFAULT_CAMERA_QUALITY_ID: CameraQualityId = "720p30";

export const CAMERA_QUALITY_PROFILES: CameraQualityProfile[] = [
  {
    id: "480p30",
    label: "480p",
    width: 854,
    height: 480,
    fps: 30,
    description: "Low bandwidth 16:9 camera mode.",
  },
  {
    id: "720p30",
    label: "720p",
    width: 1280,
    height: 720,
    fps: 30,
    description: "Recommended HD camera mode.",
  },
  {
    id: "720p60",
    label: "720p",
    width: 1280,
    height: 720,
    fps: 60,
    description: "Smoother HD camera motion.",
  },
  {
    id: "1080p30",
    label: "1080p",
    width: 1920,
    height: 1080,
    fps: 30,
    description: "Full HD camera detail.",
  },
  {
    id: "1080p60",
    label: "1080p",
    width: 1920,
    height: 1080,
    fps: 60,
    description: "Maximum camera smoothness and detail.",
  },
];

export function getCameraQualityProfile(id?: string | null): CameraQualityProfile {
  return CAMERA_QUALITY_PROFILES.find((profile) => profile.id === id) ?? CAMERA_QUALITY_PROFILES[1];
}

export function buildCameraVideoConstraints({
  deviceId,
  exactDevice,
  qualityId,
}: {
  deviceId?: string;
  exactDevice: boolean;
  qualityId?: string | null;
}): MediaTrackConstraints {
  const profile = getCameraQualityProfile(qualityId);
  const constraints: MediaTrackConstraints = {
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    aspectRatio: { ideal: 16 / 9 },
    frameRate: { ideal: profile.fps, max: profile.fps },
  };

  if (deviceId && deviceId !== "default") {
    constraints.deviceId = exactDevice ? { exact: deviceId } : { ideal: deviceId };
  }

  return constraints;
}
