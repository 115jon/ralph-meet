interface AudioCaptureOptions {
  deviceId?: string;
  audio: Omit<MediaTrackConstraints, "deviceId">;
}

function isStaleDeviceError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  return name === "OverconstrainedError" || name === "NotFoundError";
}

/** Capture audio with a persisted-device fallback for settings-only flows. */
export async function getAudioCaptureStream({
  deviceId,
  audio,
}: AudioCaptureOptions): Promise<MediaStream> {
  const exactDevice =
    deviceId && deviceId !== "default" && !deviceId.startsWith("native:");
  const constraints: MediaStreamConstraints = {
    audio: {
      ...audio,
      deviceId: exactDevice ? { exact: deviceId } : undefined,
    },
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    if (!exactDevice || !isStaleDeviceError(error)) throw error;

    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...audio,
        deviceId: undefined,
      },
    });
  }
}
