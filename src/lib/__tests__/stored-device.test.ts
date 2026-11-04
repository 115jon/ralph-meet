import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshedDeviceId, resolveStoredDeviceId } from "../stored-device";

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

function stubDevices(devices: MediaDeviceInfo[]) {
  vi.stubGlobal("navigator", {
    mediaDevices: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
  });
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

  it("keeps a saved id the list still has", async () => {
    stubDevices([
      device("audiooutput", "default", "Default - Speakers", "g-speakers"),
      device("audiooutput", "saved-out", "Headphones", "g-headphones"),
    ]);

    await expect(
      resolveStoredDeviceId(
        "audiooutput",
        { deviceId: "saved-out", label: "Headphones" },
        quietLog,
      ),
    ).resolves.toEqual({ deviceId: "saved-out", unverified: false });
  });

  it("finds a renamed id by groupId, skipping the default alias of that device", async () => {
    stubDevices([
      device("audioinput", "default", "Default - Shure MV7", "g-shure"),
      device(
        "audioinput",
        "communications",
        "Communications - Shure MV7",
        "g-shure",
      ),
      device("audioinput", "new-shure", "Shure MV7", "g-shure"),
    ]);

    await expect(
      resolveStoredDeviceId(
        "audioinput",
        { deviceId: "old-shure", label: "Shure MV7", groupId: "g-shure" },
        quietLog,
      ),
    ).resolves.toEqual({ deviceId: "new-shure", unverified: false });
  });

  it("finds a renamed id by label when the groupId changed too", async () => {
    stubDevices([
      device("audiooutput", "default", "Default - Speakers", "g-new-1"),
      device("audiooutput", "new-headphones", " headphones ", "g-new-2"),
    ]);

    await expect(
      resolveStoredDeviceId(
        "audiooutput",
        { deviceId: "old-headphones", label: "Headphones", groupId: "g-old" },
        quietLog,
      ),
    ).resolves.toEqual({ deviceId: "new-headphones", unverified: false });
  });

  it("falls back to the system default when the saved device is gone", async () => {
    stubDevices([device("audioinput", "other-mic", "Webcam Mic", "g-cam")]);

    await expect(
      resolveStoredDeviceId(
        "audioinput",
        { deviceId: "old-shure", label: "Shure MV7", groupId: "g-shure" },
        quietLog,
      ),
    ).resolves.toEqual({ deviceId: "default", unverified: false });
  });
});

describe("refreshedDeviceId", () => {
  const savedShure = {
    deviceId: "old-shure",
    label: "Shure MV7",
    groupId: "g-shure",
  };

  it("saves a new id for the same physical device", () => {
    expect(
      refreshedDeviceId(savedShure, {
        deviceId: "new-shure",
        label: "Shure MV7",
        groupId: "g-other",
      }),
    ).toBe("new-shure");
    expect(
      refreshedDeviceId(savedShure, {
        deviceId: "new-shure",
        label: "Microphone (Shure MV7)",
        groupId: "g-shure",
      }),
    ).toBe("new-shure");
  });

  it("keeps the saved choice when capture fell back to another device", () => {
    expect(
      refreshedDeviceId(savedShure, {
        deviceId: "webcam-mic",
        label: "Webcam Mic",
        groupId: "g-cam",
      }),
    ).toBeNull();
    expect(
      refreshedDeviceId(savedShure, {
        deviceId: "default",
        label: "Default - Shure MV7",
        groupId: "g-shure",
      }),
    ).toBeNull();
  });

  it("keeps System default following the OS", () => {
    expect(
      refreshedDeviceId(
        { deviceId: "default" },
        { deviceId: "shure", label: "Shure MV7", groupId: "g-shure" },
      ),
    ).toBeNull();
  });

  it("does nothing when the id already matches", () => {
    expect(
      refreshedDeviceId(savedShure, { ...savedShure, deviceId: "old-shure" }),
    ).toBeNull();
  });
});
