import { describe, expect, it } from "vitest";
import {
  captureAnswersRequest,
  captureErrorAction,
  captureOutcome,
  captureProcessingFor,
  captureProcessingMatches,
  captureTarget,
  deviceListKey,
  deviceSatisfies,
  deviceToPersist,
  fallbackRetryId,
  isHiddenDeviceList,
  listedDeviceId,
  liveCaptureMatches,
  matchSavedDevice,
  resolveOutputDevice,
  resolveSavedDevice,
  type CaptureRecord,
  type DeviceSyncState,
  type ListedDevice,
  type SavedDevice,
} from "../devices";

function device(deviceId: string, label: string, groupId = ""): ListedDevice {
  return { deviceId, label, groupId };
}

/** What Chromium lists before the page has media permission. */
const hiddenList = [device("", ""), device("", "")];

const savedShure: SavedDevice = {
  deviceId: "old-shure",
  label: "Shure MV7",
  groupId: "g-shure",
};

describe("isHiddenDeviceList", () => {
  it("is hidden when entries exist but none has an id and label", () => {
    expect(isHiddenDeviceList(hiddenList)).toBe(true);
    expect(isHiddenDeviceList([device("default", "")])).toBe(true);
  });

  it("is not hidden when empty (no devices) or readable", () => {
    expect(isHiddenDeviceList([])).toBe(false);
    expect(isHiddenDeviceList([device("mic", "Mic")])).toBe(false);
  });
});

describe("resolveSavedDevice", () => {
  it("opens the system default when nothing concrete is saved", () => {
    expect(resolveSavedDevice({ deviceId: "default" }, [])).toEqual({
      outcome: "default",
      deviceId: "default",
    });
    expect(resolveSavedDevice({}, null)).toEqual({
      outcome: "default",
      deviceId: undefined,
    });
  });

  it("passes a saved id through unverified while the device list is hidden", () => {
    expect(resolveSavedDevice(savedShure, hiddenList)).toEqual({
      outcome: "unverified",
      deviceId: "old-shure",
    });
  });

  it("passes a saved id through unverified when the platform cannot list", () => {
    expect(resolveSavedDevice(savedShure, null)).toEqual({
      outcome: "unverified",
      deviceId: "old-shure",
    });
  });

  it("keeps a saved id the list still has", () => {
    expect(
      resolveSavedDevice({ deviceId: "saved-out", label: "Headphones" }, [
        device("default", "Default - Speakers", "g-speakers"),
        device("saved-out", "Headphones", "g-headphones"),
      ]),
    ).toEqual({ outcome: "listed", deviceId: "saved-out", by: "id" });
  });

  it("finds a renamed id by label, skipping the default aliases of that device", () => {
    expect(
      resolveSavedDevice(savedShure, [
        device("default", "Default - Shure MV7", "g-shure"),
        device("communications", "Communications - Shure MV7", "g-shure"),
        device("new-shure", "Shure MV7", "g-shure"),
      ]),
    ).toEqual({ outcome: "listed", deviceId: "new-shure", by: "label" });
  });

  it("finds a renamed id by label when the groupId changed too", () => {
    expect(
      resolveSavedDevice(
        { deviceId: "old-headphones", label: "Headphones", groupId: "g-old" },
        [
          device("default", "Default - Speakers", "g-new-1"),
          device("new-headphones", " headphones ", "g-new-2"),
        ],
      ),
    ).toEqual({ outcome: "listed", deviceId: "new-headphones", by: "label" });
  });

  it("finds a renamed id by a unique groupId when the label changed", () => {
    expect(
      resolveSavedDevice(
        { deviceId: "old", label: "USB Audio", groupId: "g-shure" },
        [
          device("default", "Default - Shure MV7", "g-shure"),
          device("shure", "Shure MV7", "g-shure"),
          device("webcam", "Webcam Mic", "g-cam"),
        ],
      ),
    ).toEqual({ outcome: "listed", deviceId: "shure", by: "groupId" });
  });

  it("reports a saved device the readable list does not have as missing", () => {
    expect(
      resolveSavedDevice(savedShure, [
        device("other-mic", "Webcam Mic", "g-cam"),
      ]),
    ).toEqual({ outcome: "missing", deviceId: "default" });
  });

  it("reports a saved device as missing when no device is listed at all", () => {
    expect(resolveSavedDevice(savedShure, [])).toEqual({
      outcome: "missing",
      deviceId: "default",
    });
  });
});

describe("sibling endpoints sharing a groupId", () => {
  // Windows lists a sound card's inputs under one groupId.
  const realtek = [
    device("default", "Default - Microphone (Realtek)", "g-rt"),
    device("new-mic", "Microphone (Realtek)", "g-rt"),
    device("new-line", "Line In (Realtek)", "g-rt"),
    device("new-mix", "Stereo Mix (Realtek)", "g-rt"),
  ];

  it("prefers the label over a sibling that shares the groupId", () => {
    expect(
      resolveSavedDevice(
        { deviceId: "old-line", label: "Line In (Realtek)", groupId: "g-rt" },
        realtek,
      ),
    ).toEqual({ outcome: "listed", deviceId: "new-line", by: "label" });
  });

  it("does not guess between siblings when no label matches", () => {
    expect(
      resolveSavedDevice(
        { deviceId: "old-line", label: "Line In (Realtek)", groupId: "g-rt" },
        [realtek[1]!, realtek[3]!],
      ),
    ).toEqual({ outcome: "missing", deviceId: "default" });
  });

  it("takes the one sibling whose decorated label overlaps", () => {
    expect(
      matchSavedDevice(
        [
          device("mic", "Microphone (Shure MV7)", "g-shure"),
          device("mix", "Stereo Mix (Other)", "g-shure"),
        ],
        { deviceId: "old", label: "Shure MV7", groupId: "g-shure" },
      ),
    ).toMatchObject({ device: { deviceId: "mic" }, by: "groupId" });
  });

  it("prefers the endpoint in the saved group when two share a label", () => {
    expect(
      matchSavedDevice(
        [device("a", "Headset", "g-a"), device("b", "Headset", "g-b")],
        { deviceId: "old", label: "Headset", groupId: "g-b" },
      )?.device.deviceId,
    ).toBe("b");
  });

  it("never saves a sibling endpoint", () => {
    expect(
      deviceToPersist(
        { deviceId: "old-line", label: "Line In (Realtek)", groupId: "g-rt" },
        { deviceId: "mic", label: "Microphone (Realtek)", groupId: "g-rt" },
      ),
    ).toBeNull();
  });
});

describe("matchSavedDevice", () => {
  const list = [
    device("default", "Default - Shure MV7", "g-shure"),
    device("shure", "Shure MV7", "g-shure"),
    device("webcam", "Webcam Mic", "g-cam"),
  ];

  it("matches by id, then label, then a unique groupId", () => {
    expect(matchSavedDevice(list, { deviceId: "shure" })?.by).toBe("id");
    expect(
      matchSavedDevice(list, { deviceId: "old", label: "webcam mic" }),
    ).toMatchObject({ device: { deviceId: "webcam" }, by: "label" });
    expect(
      matchSavedDevice(list, { deviceId: "old", groupId: "g-shure" }),
    ).toMatchObject({ device: { deviceId: "shure" }, by: "groupId" });
  });

  it("returns null for the system default and for devices not listed", () => {
    expect(matchSavedDevice(list, { deviceId: "default" })).toBeNull();
    expect(
      matchSavedDevice(list, { deviceId: "gone", label: "Yeti", groupId: "g" }),
    ).toBeNull();
  });

  it("never matches a desktop-native id by id, only by label or group", () => {
    const withNative = [device("native:mic", "Other"), ...list];
    expect(
      matchSavedDevice(withNative, {
        deviceId: "native:mic",
        label: "Shure MV7",
      })?.device.deviceId,
    ).toBe("shure");
  });

  it("listedDeviceId is where the saved device is listed, or null", () => {
    expect(listedDeviceId(list, { deviceId: "old", label: "Shure MV7" })).toBe(
      "shure",
    );
    expect(listedDeviceId(hiddenList, savedShure)).toBeNull();
    expect(listedDeviceId(list, { deviceId: "default" })).toBeNull();
  });
});

describe("opening a device", () => {
  it("requires a concrete id exactly and leaves the default to the platform", () => {
    expect(captureTarget("shure")).toEqual({ deviceId: "shure", exact: true });
    expect(captureTarget("default")).toEqual({
      deviceId: undefined,
      exact: false,
    });
    expect(captureTarget(undefined)).toEqual({
      deviceId: undefined,
      exact: false,
    });
  });

  it("falls back to the system default only when the device cannot be found", () => {
    expect(captureErrorAction("OverconstrainedError")).toBe(
      "retry-system-default",
    );
    expect(captureErrorAction("NotFoundError")).toBe("retry-system-default");
    expect(captureErrorAction("NotAllowedError")).toBe("permission-denied");
    expect(captureErrorAction("NotReadableError")).toBe("fail");
    expect(captureErrorAction(undefined)).toBe("fail");
  });

  it("the default accepts any device; a concrete id only itself", () => {
    expect(deviceSatisfies("default", "anything")).toBe(true);
    expect(deviceSatisfies(undefined, "anything")).toBe(true);
    expect(deviceSatisfies("shure", "shure")).toBe(true);
    expect(deviceSatisfies("shure", "webcam")).toBe(false);
  });
});

describe("captureAnswersRequest (reusing the live capture)", () => {
  it("reuses a fallback opened for the same saved id while the list stays hidden", () => {
    const hidden = resolveSavedDevice(savedShure, hiddenList);
    expect(
      captureAnswersRequest("old-shure", hidden, {
        requestedId: "old-shure",
        deviceId: "webcam",
      }),
    ).toBe(true);
    // Opened for another choice: the hidden saved id is opened blind.
    expect(
      captureAnswersRequest("old-shure", hidden, {
        requestedId: "default",
        deviceId: "webcam",
      }),
    ).toBe(false);
  });

  it("keeps a fallback for a missing device only if it was opened for it", () => {
    const missing = resolveSavedDevice(savedShure, [
      device("webcam", "Webcam"),
    ]);
    expect(
      captureAnswersRequest("old-shure", missing, {
        requestedId: "old-shure",
        deviceId: "webcam",
      }),
    ).toBe(true);
    expect(
      captureAnswersRequest("old-shure", missing, {
        requestedId: "other",
        deviceId: "webcam",
      }),
    ).toBe(false);
  });

  it("reuses a capture on the refreshed id of the saved device", () => {
    const listed = resolveSavedDevice(savedShure, [
      device("new-shure", "Shure MV7", "g-shure"),
    ]);
    expect(
      captureAnswersRequest("old-shure", listed, {
        requestedId: "old-shure",
        deviceId: "new-shure",
      }),
    ).toBe(true);
    expect(
      captureAnswersRequest("old-shure", listed, {
        requestedId: "old-shure",
        deviceId: "webcam",
      }),
    ).toBe(false);
  });

  it("reuses any capture for the system default", () => {
    expect(
      captureAnswersRequest(
        "default",
        resolveSavedDevice({ deviceId: "default" }, []),
        {
          requestedId: "shure",
          deviceId: "shure",
        },
      ),
    ).toBe(true);
  });
});

describe("liveCaptureMatches (when to capture again)", () => {
  const track = { id: "fallback-track" };
  const record: CaptureRecord<typeof track> = {
    track,
    savedId: "saved-shure",
    listedId: null,
    selection: 3,
  };
  const onFallback: DeviceSyncState<typeof track> = {
    savedId: "saved-shure",
    listedId: null,
    selection: 3,
    track,
    trackDeviceId: "webcam-mic",
    record,
  };

  it("keeps a fallback capture while nothing moved (an unrelated sync)", () => {
    expect(liveCaptureMatches(onFallback)).toBe(true);
  });

  it("captures again when the saved device is plugged back in", () => {
    expect(liveCaptureMatches({ ...onFallback, listedId: "saved-shure" })).toBe(
      false,
    );
  });

  it("captures again when the user picks the same device again", () => {
    expect(liveCaptureMatches({ ...onFallback, selection: 4 })).toBe(false);
  });

  it("re-picking the device that is already open keeps it", () => {
    expect(
      liveCaptureMatches({
        ...onFallback,
        trackDeviceId: "saved-shure",
        selection: 4,
      }),
    ).toBe(true);
  });

  it("captures again when the saved choice changed", () => {
    expect(liveCaptureMatches({ ...onFallback, savedId: "yeti" })).toBe(false);
  });

  it("captures again for a track it has no record of", () => {
    expect(liveCaptureMatches({ ...onFallback, record: null })).toBe(false);
    expect(liveCaptureMatches({ ...onFallback, track: { id: "other" } })).toBe(
      false,
    );
  });

  it("keeps a capture on the saved device under its listed (refreshed) id", () => {
    expect(
      liveCaptureMatches({
        ...onFallback,
        listedId: "new-shure",
        trackDeviceId: "new-shure",
        record: null,
      }),
    ).toBe(true);
  });

  it("keeps any capture while the system default is saved", () => {
    expect(
      liveCaptureMatches({
        ...onFallback,
        savedId: "default",
        trackDeviceId: "whatever",
        record: null,
      }),
    ).toBe(true);
  });

  it("captures again when capture-level processing changed", () => {
    const wanted = {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: false,
    };
    expect(captureProcessingMatches(wanted, wanted)).toBe(true);
    expect(
      captureProcessingMatches({ ...wanted, noiseSuppression: false }, wanted),
    ).toBe(false);
    expect(captureProcessingMatches({}, wanted)).toBe(false);
  });
});

describe("fallbackRetryId", () => {
  it("follows the listed id only while a fallback is live", () => {
    expect(fallbackRetryId(false, "saved-shure")).toBeNull();
    expect(fallbackRetryId(true, null)).toBeNull();
    expect(fallbackRetryId(true, "saved-shure")).toBe("saved-shure");
  });
});

describe("what is saved after a capture (captureOutcome)", () => {
  it("saves a new id for the same physical device", () => {
    expect(
      deviceToPersist(savedShure, {
        deviceId: "new-shure",
        label: "Shure MV7",
        groupId: "g-other",
      }),
    ).toBe("new-shure");
    expect(
      deviceToPersist(savedShure, {
        deviceId: "new-shure",
        label: "Microphone (Shure MV7)",
        groupId: "g-shure",
      }),
    ).toBe("new-shure");
    expect(
      captureOutcome(savedShure, {
        deviceId: "new-shure",
        label: "Shure MV7",
      }),
    ).toEqual({ persist: "new-shure", fellBack: false });
  });

  it("saves a same-group id when a label is unknown", () => {
    expect(
      deviceToPersist(
        { deviceId: "old", groupId: "g-shure" },
        { deviceId: "new", label: "Shure MV7", groupId: "g-shure" },
      ),
    ).toBe("new");
  });

  it("never overwrites the saved choice with a fallback (unplugged saved device)", () => {
    expect(
      captureOutcome(savedShure, {
        deviceId: "webcam-mic",
        label: "Webcam Mic",
        groupId: "g-cam",
      }),
    ).toEqual({ persist: null, fellBack: true });
    // The default alias of the same device is still a fallback, never saved.
    expect(
      captureOutcome(savedShure, {
        deviceId: "default",
        label: "Default - Shure MV7",
        groupId: "g-shure",
      }),
    ).toEqual({ persist: null, fellBack: true });
  });

  it("keeps System default following the OS", () => {
    expect(
      captureOutcome(
        { deviceId: "default" },
        { deviceId: "shure", label: "Shure MV7", groupId: "g-shure" },
      ),
    ).toEqual({ persist: null, fellBack: false });
    expect(
      captureOutcome({}, { deviceId: "shure", label: "Shure MV7" }),
    ).toEqual({ persist: null, fellBack: false });
  });

  it("does nothing when the capture opened the saved id", () => {
    expect(
      captureOutcome(savedShure, { ...savedShure, deviceId: "old-shure" }),
    ).toEqual({ persist: null, fellBack: false });
  });
});

describe("output routing (resolveOutputDevice)", () => {
  const savedHeadphones: SavedDevice = {
    deviceId: "old-headphones",
    label: "Headphones",
    groupId: "g-old",
  };

  it("tries the saved speaker as it is while the list is hidden", () => {
    expect(resolveOutputDevice(savedHeadphones, hiddenList)).toBe(
      "old-headphones",
    );
    expect(resolveOutputDevice(savedHeadphones, null)).toBe("old-headphones");
  });

  it("routes to the refreshed id once the list unlocks", () => {
    expect(
      resolveOutputDevice(savedHeadphones, [
        device("default", "Default - Speakers", "g-speakers"),
        device("new-headphones", "Headphones", "g-new"),
      ]),
    ).toBe("new-headphones");
  });

  it("routes to the system default when the saved speaker is gone", () => {
    expect(
      resolveOutputDevice(savedHeadphones, [
        device("default", "Default - Speakers"),
        device("speakers", "Speakers"),
      ]),
    ).toBe("default");
  });

  it("keeps the default as the default", () => {
    expect(resolveOutputDevice({ deviceId: "default" }, [])).toBe("default");
    expect(resolveOutputDevice({}, [])).toBe("default");
  });

  it("deviceListKey changes when an entry appears, goes or is relabelled", () => {
    const before = [device("", "")];
    const unlocked = [device("default", "Default - Speakers", "g")];
    expect(deviceListKey(before)).not.toBe(deviceListKey(unlocked));
    expect(deviceListKey(unlocked)).toBe(deviceListKey([...unlocked]));
    expect(
      deviceListKey([...unlocked, device("usb", "USB Headset", "g2")]),
    ).not.toBe(deviceListKey(unlocked));
  });
});

describe("captureProcessingFor (what the microphone is opened with)", () => {
  const standard = {
    noiseSuppression: true,
    echoCancellation: true,
    noiseReductionEnabled: false,
    streamHighFidelity: false,
  };

  it("follows the settings, with automatic gain control on", () => {
    expect(captureProcessingFor(standard)).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
    expect(
      captureProcessingFor({ ...standard, echoCancellation: false }),
    ).toMatchObject({ echoCancellation: false });
  });

  it("turns platform noise suppression off while RNNoise runs", () => {
    expect(
      captureProcessingFor({ ...standard, noiseReductionEnabled: true }),
    ).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it("turns all capture processing off in high fidelity", () => {
    expect(
      captureProcessingFor({ ...standard, streamHighFidelity: true }),
    ).toEqual({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
    });
  });
});
