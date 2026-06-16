import { describe, expect, it } from "vitest";
import {
  mergeNativeAudioLabels,
  mergeNativeVideoLabels,
  type MediaDeviceInfo_Custom,
  type NativeDevice,
} from "../media-device-snapshot";

describe("media-device-snapshot", () => {
  describe("mergeNativeAudioLabels", () => {
    it("should merge native labels onto browser devices", () => {
      const browserDevices: MediaDeviceInfo_Custom[] = [
        { deviceId: "default", label: "Default Microphone", kind: "audioinput" },
        { deviceId: "device1", label: "", kind: "audioinput" },
      ];
      const nativeDevices: NativeDevice[] = [
        { device_id: "native-id-default", label: "Real Mic Default", kind: "audioinput", is_default: true },
        { device_id: "native-id-1", label: "Real Mic 1", kind: "audioinput", is_default: false },
      ];

      const merged = mergeNativeAudioLabels(browserDevices, nativeDevices, "audioinput");
      expect(merged).toHaveLength(2);
      expect(merged[0].label).toBe("Real Mic Default");
      expect(merged[0].isDefault).toBe(true);
      expect(merged[0].isNative).toBe(true);

      expect(merged[1].label).toBe("Real Mic 1");
      expect(merged[1].nativeDeviceId).toBe("native-id-1");
      expect(merged[1].isNative).toBe(true);
    });
  });

  describe("mergeNativeVideoLabels", () => {
    it("should merge native camera labels onto browser video devices", () => {
      const browserDevices: MediaDeviceInfo_Custom[] = [
        { deviceId: "cam1", label: "Camera 1", kind: "videoinput" },
        { deviceId: "cam2", label: "Camera 2", kind: "videoinput" },
      ];
      const nativeDevices: NativeDevice[] = [
        { device_id: "vid-id-1", label: "USB Webcam", kind: "videoinput", is_default: false },
        { device_id: "vid-id-2", label: "Integrated Camera", kind: "videoinput", is_default: false },
      ];

      const merged = mergeNativeVideoLabels(browserDevices, nativeDevices);
      expect(merged).toHaveLength(2);
      expect(merged[0].label).toBe("USB Webcam");
      expect(merged[0].nativeDeviceId).toBe("vid-id-1");
      expect(merged[0].isNative).toBe(true);

      expect(merged[1].label).toBe("Integrated Camera");
      expect(merged[1].nativeDeviceId).toBe("vid-id-2");
      expect(merged[1].isNative).toBe(true);
    });

    it("should match by name if browser provides a non-generic label", () => {
      const browserDevices: MediaDeviceInfo_Custom[] = [
        { deviceId: "cam1", label: "integrated camera", kind: "videoinput" },
      ];
      const nativeDevices: NativeDevice[] = [
        { device_id: "vid-id-1", label: "USB Webcam", kind: "videoinput", is_default: false },
        { device_id: "vid-id-2", label: "Integrated Camera", kind: "videoinput", is_default: false },
      ];

      const merged = mergeNativeVideoLabels(browserDevices, nativeDevices);
      expect(merged).toHaveLength(1);
      expect(merged[0].label).toBe("integrated camera");
      expect(merged[0].nativeDeviceId).toBe("vid-id-2");
      expect(merged[0].isNative).toBe(true);
    });
  });
});
