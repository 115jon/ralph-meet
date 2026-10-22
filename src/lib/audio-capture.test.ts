import { afterEach, describe, expect, it, vi } from "vitest";
import { getAudioCaptureStream } from "./audio-capture";

const audio = {
  echoCancellation: true,
  noiseSuppression: true,
};

describe("getAudioCaptureStream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries with the system default when a stored device is stale", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce({ name: "OverconstrainedError" })
      .mockResolvedValueOnce(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(
      getAudioCaptureStream({ deviceId: "old-device", audio }),
    ).resolves.toBe(stream);

    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: { ...audio, deviceId: { exact: "old-device" } },
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: { ...audio, deviceId: undefined },
    });
  });

  it("does not hide permission errors behind a default retry", async () => {
    const error = { name: "NotAllowedError" };
    const getUserMedia = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(
      getAudioCaptureStream({ deviceId: "old-device", audio }),
    ).rejects.toBe(error);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
