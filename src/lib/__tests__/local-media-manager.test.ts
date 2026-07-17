import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLocalStream,
  releaseLocalStream,
  startEarlyMic,
  type LocalAudioConstraints,
} from "../local-media-manager";

const audioConstraints: LocalAudioConstraints = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

describe("local-media-manager", () => {
  afterEach(() => {
    releaseLocalStream();
    vi.unstubAllGlobals();
  });

  it("stops an early microphone stream that resolves after release", async () => {
    let resolveCapture: (stream: MediaStream) => void = () => {};
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveCapture = resolve;
        }),
    );
    const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
    } as unknown as MediaStream;

    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });

    const pendingCapture = startEarlyMic(audioConstraints);
    await Promise.resolve();
    releaseLocalStream();
    resolveCapture(stream);

    await expect(pendingCapture).resolves.toBeNull();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("does not start capture when a stored-device lookup resolves after release", async () => {
    let resolveDevices: (devices: MediaDeviceInfo[]) => void = () => {};
    const enumerateDevices = vi.fn(
      () =>
        new Promise<MediaDeviceInfo[]>((resolve) => {
          resolveDevices = resolve;
        }),
    );
    const getUserMedia = vi.fn();

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    const pendingCapture = acquireLocalStream(
      { ...audioConstraints, deviceId: "stored-device" },
      null,
    );
    await Promise.resolve();
    releaseLocalStream();
    resolveDevices([
      {
        deviceId: "stored-device",
        groupId: "group-1",
        label: "Microphone",
        kind: "audioinput",
      } as MediaDeviceInfo,
    ]);

    await expect(pendingCapture).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
