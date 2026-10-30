// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true, user: { id: "user-1" } }),
}));

vi.mock("@/lib/platform", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/platform")>("@/lib/platform");
  return { ...actual, isDesktop: () => false };
});

vi.mock("@/lib/camera-backgrounds", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/camera-backgrounds")
  >("@/lib/camera-backgrounds");
  return {
    ...actual,
    listCameraBackgrounds: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock("../InputSensitivityMeter", () => ({
  InputSensitivityMeter: () => null,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import CameraCard from "../settings/CameraCard";
import VoiceVideoPanel from "../settings/VoiceVideoPanel";
import {
  classifyMediaError,
  describeMediaError,
} from "../settings/useDeviceAccess";

const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
  ({ kind, deviceId, label, groupId: "g" }) as MediaDeviceInfo;

const fakeStream = () =>
  ({ getTracks: () => [], getVideoTracks: () => [] }) as unknown as MediaStream;

function fakeMedia({
  enumerate,
  getUserMedia,
}: {
  enumerate: () => Promise<MediaDeviceInfo[]>;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
}) {
  const media = {
    enumerateDevices: vi.fn(enumerate),
    getUserMedia: vi.fn(getUserMedia ?? (() => Promise.resolve(fakeStream()))),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: media,
  });
  return media;
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
});

const renderVoice = () =>
  render(
    <TooltipProvider>
      <VoiceVideoPanel includeCamera={false} />
    </TooltipProvider>,
  );

describe("media error copy", () => {
  it("never shows the browser's message", () => {
    const err = new DOMException(
      "Permission denied by system",
      "NotAllowedError",
    );
    expect(classifyMediaError(err)).toBe("denied");
    const copy = describeMediaError(err, "audioinput");
    expect(copy).toMatch(/^Microphone access is off/);
    expect(copy).not.toContain("Permission denied by system");
    expect(describeMediaError(new Error("boom"), "videoinput")).toBe(
      "Unable to reach your camera. Try again.",
    );
  });
});

describe("VoiceVideoPanel device states", () => {
  it("shows a loading placeholder while devices are listed", () => {
    fakeMedia({ enumerate: () => new Promise(() => {}) });
    renderVoice();
    expect(screen.getByText("Loading microphones")).toBeInTheDocument();
  });

  it("says when there is no microphone", async () => {
    fakeMedia({
      enumerate: () => Promise.resolve([device("audiooutput", "o", "Spk")]),
    });
    renderVoice();
    expect(
      await screen.findByText("No microphone found. Plug one in, then retry."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("asks for mic access when devices are unlabeled, then rescans", async () => {
    let granted = false;
    const media = fakeMedia({
      enumerate: () =>
        Promise.resolve([
          device("audioinput", "mic-1", granted ? "Studio Mic" : ""),
        ]),
      getUserMedia: () => {
        granted = true;
        return Promise.resolve(fakeStream());
      },
    });
    renderVoice();
    const allow = await screen.findByRole("button", { name: /Allow access/ });
    expect(screen.getByText("Allow microphone access")).toBeVisible();
    await userEvent.click(allow);
    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true });
    await waitFor(() =>
      expect(screen.queryByText("Allow microphone access")).toBeNull(),
    );
  });

  it("explains a refused request without the raw error", async () => {
    fakeMedia({
      enumerate: () => Promise.resolve([device("audioinput", "mic-1", "")]),
      getUserMedia: () =>
        Promise.reject(new DOMException("raw text", "NotAllowedError")),
    });
    renderVoice();
    await userEvent.click(
      await screen.findByRole("button", { name: /Allow access/ }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Microphone access is off/);
    expect(alert).not.toHaveTextContent("raw text");
  });
});

describe("CameraCard states", () => {
  it("shows a spinner while the camera starts", async () => {
    fakeMedia({
      enumerate: () =>
        Promise.resolve([device("videoinput", "cam-1", "FaceTime")]),
      getUserMedia: () => new Promise(() => {}),
    });
    render(<CameraCard settingsUserId="u-1" autoPreview bare />);
    expect(await screen.findByText("Starting camera")).toBeInTheDocument();
  });

  it("shows how to allow access when the camera is refused", async () => {
    fakeMedia({
      enumerate: () => Promise.resolve([device("videoinput", "cam-1", "")]),
      getUserMedia: () =>
        Promise.reject(new DOMException("nope", "NotAllowedError")),
    });
    render(<CameraCard settingsUserId="u-1" autoPreview bare />);
    expect(await screen.findByText("Camera access is off")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("shows an empty state when there is no camera", async () => {
    fakeMedia({
      enumerate: () => Promise.resolve([device("audioinput", "m", "Mic")]),
    });
    render(<CameraCard settingsUserId="u-1" bare />);
    expect(await screen.findByText("No camera found")).toBeVisible();
    expect(screen.getByText("Plug in a camera, then try again.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    // The background tiles stay visible, disabled, with the reason.
    expect(screen.getByRole("radio", { name: "Blur" })).toBeDisabled();
    expect(screen.getByText("Plug in a camera first.")).toBeVisible();
  });
});
