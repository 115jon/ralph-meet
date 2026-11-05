// The browser side of saved devices: reading enumerateDevices() for the
// @ralph/voice decisions. The decision table itself is tested in
// packages/voice/src/__tests__/devices.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupSavedDevice,
  resolveOutputSinkId,
  resolveStoredDeviceId,
} from "../stored-device";

const quietLog = { info: vi.fn(), warn: vi.fn() };

function device(
  kind: MediaDeviceKind,
  deviceId: string,
  label: string,
  groupId = "",
): MediaDeviceInfo {
  return { deviceId, groupId, kind, label } as MediaDeviceInfo;
}

/** What Chromium lists before the page has media permission. */
const hiddenList = [
  device("audioinput", "", ""),
  device("audiooutput", "", ""),
  device("videoinput", "", ""),
];

function stubDevices(devices: MediaDeviceInfo[] | Error) {
  const enumerateDevices =
    devices instanceof Error
      ? vi.fn().mockRejectedValue(devices)
      : vi.fn().mockResolvedValue(devices);
  vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices } });
  return enumerateDevices;
}

describe("resolveStoredDeviceId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes a saved id through unverified while the device list is hidden", async () => {
    stubDevices(hiddenList);

    await expect(
      resolveStoredDeviceId(
        "audioinput",
        { deviceId: "saved-mic", label: "Shure MV7", groupId: "g-shure" },
        quietLog,
      ),
    ).resolves.toEqual({ deviceId: "saved-mic", unverified: true });
  });

  it("passes a saved id through unverified when the browser cannot list", async () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });

    await expect(
      resolveStoredDeviceId("audioinput", { deviceId: "saved-mic" }, quietLog),
    ).resolves.toEqual({ deviceId: "saved-mic", unverified: true });
  });

  it("only looks at devices of the asked kind", async () => {
    stubDevices([
      device("audiooutput", "new-shure", "Shure MV7", "g-shure"),
      device("audioinput", "webcam", "Webcam Mic", "g-cam"),
    ]);

    await expect(
      resolveStoredDeviceId(
        "audioinput",
        { deviceId: "old-shure", label: "Shure MV7", groupId: "g-shure" },
        quietLog,
      ),
    ).resolves.toEqual({ deviceId: "default", unverified: false });
  });

  it("finds a renamed id in the live list", async () => {
    stubDevices([
      device("audioinput", "default", "Default - Shure MV7", "g-shure"),
      device("audioinput", "new-shure", "Shure MV7", "g-shure"),
    ]);

    await expect(
      lookupSavedDevice(
        "audioinput",
        { deviceId: "old-shure", label: "Shure MV7", groupId: "g-shure" },
        quietLog,
      ),
    ).resolves.toEqual({
      outcome: "listed",
      deviceId: "new-shure",
      by: "label",
    });
  });

  it("does not enumerate for the system default", async () => {
    const enumerateDevices = stubDevices(hiddenList);

    await expect(
      resolveStoredDeviceId("audioinput", { deviceId: "default" }, quietLog),
    ).resolves.toEqual({ deviceId: "default", unverified: false });
    expect(enumerateDevices).not.toHaveBeenCalled();
  });
});

describe("resolveOutputSinkId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const saved = {
    deviceId: "old-headphones",
    label: "Headphones",
    groupId: "g-old",
  };

  it("routes to the refreshed speaker id", async () => {
    stubDevices([
      device("audiooutput", "default", "Default - Speakers", "g-speakers"),
      device("audiooutput", "new-headphones", "Headphones", "g-new"),
    ]);
    await expect(resolveOutputSinkId(saved, quietLog)).resolves.toBe(
      "new-headphones",
    );
  });

  it("tries the saved id as it is when the lookup fails", async () => {
    stubDevices(new Error("enumerate failed"));
    await expect(resolveOutputSinkId(saved, quietLog)).resolves.toBe(
      "old-headphones",
    );
  });

  it("routes the system default to the default", async () => {
    stubDevices(hiddenList);
    await expect(resolveOutputSinkId({}, quietLog)).resolves.toBe("default");
  });
});
