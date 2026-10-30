// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";
import { VoiceDashboard } from "../VoiceDashboard";

vi.mock("@/hooks/useVoiceStats", () => ({
  useVoiceStats: () => null,
}));
vi.mock("@/components/CameraSettingsModal", () => ({
  CameraSettingsModal: () => null,
}));
vi.mock("@/components/voice/VoiceDetailsPanel", () => ({
  VoiceDetailsPanel: () => null,
}));
vi.mock("../FloatingListenTogetherPlayer", () => ({
  FloatingListenTogetherPlayer: () => null,
}));
vi.mock("../FloatingSoundboardManager", () => ({
  FloatingSoundboardManager: () => null,
}));
vi.mock("@/components/chat/SoundboardPicker", () => ({
  default: () => null,
}));
vi.mock("@/components/chat/GifPickerModal", () => ({
  default: () => null,
}));

function renderDashboard(
  overrides: Partial<React.ComponentProps<typeof VoiceDashboard>> = {},
) {
  const props = {
    serverName: "Ralph HQ",
    voiceChannelName: "Lounge",
    voiceSettingsUserId: "u-me",
    localUserId: "u-me",
    isScreenSharing: true,
    isStreamingAudio: true,
    screenQuality: "1080p60",
    availableQualities: ["720p30", "1080p30", "1080p60"],
    onStreamQualityChange: vi.fn(),
    onToggleStreamAudio: vi.fn(),
    onChangeStreamSource: vi.fn(),
    onStopStreaming: vi.fn(),
    ...overrides,
  };
  render(<VoiceDashboard {...props} />);
  return props;
}

function setPhoneViewport(isPhone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isPhone,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("VoiceDashboard stream settings menu", () => {
  afterEach(() => {
    // jsdom has no matchMedia by default; restore that.
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("opens from its trigger and choosing a quality calls onStreamQualityChange", async () => {
    const props = renderDashboard();
    const trigger = screen.getByRole("button", { name: "Stream settings" });

    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(menu.closest("[data-rm-floating-layer]")).not.toBeNull();

    const selected = screen.getByRole("menuitemradio", { name: "1080p 60" });
    expect(selected).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "720p 30" }));
    expect(props.onStreamQualityChange).toHaveBeenCalledWith("720p30");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it("runs the toggles and stop streaming from menu items", async () => {
    const props = renderDashboard();
    const trigger = screen.getByRole("button", { name: "Stream settings" });

    fireEvent.click(trigger);
    const audio = await screen.findByRole("menuitemcheckbox", {
      name: "Stream audio",
    });
    expect(audio).toHaveAttribute("aria-checked", "true");
    fireEvent.click(audio);
    expect(props.onToggleStreamAudio).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Stop streaming" }),
    );
    expect(props.onStopStreaming).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderDashboard();
    const trigger = screen.getByRole("button", { name: "Stream settings" });

    trigger.focus();
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("uses an action sheet on phones", async () => {
    setPhoneViewport(true);
    const props = renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Stream settings" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Stream settings",
    });
    expect(sheet).toHaveAttribute("data-slot", "action-sheet");

    fireEvent.click(screen.getByRole("button", { name: /Quality/ }));
    fireEvent.click(screen.getByRole("radio", { name: "720p 30" }));
    expect(props.onStreamQualityChange).toHaveBeenCalledWith("720p30");
  });
});

describe("VoiceDashboard noise suppression popover", () => {
  it("opens from the voice options menu and closes on Escape and back", async () => {
    renderDashboard({ isScreenSharing: false });
    const trigger = screen.getByRole("button", { name: "Voice options" });

    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Noise suppression/ }),
    );
    const panel = await screen.findByRole("dialog", {
      name: "Noise suppression",
    });
    expect(panel.closest("[data-rm-floating-layer]")).not.toBeNull();

    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Noise suppression" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Noise suppression/ }),
    );
    await screen.findByRole("dialog", { name: "Noise suppression" });
    act(() => {
      executeBackHandlers();
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Noise suppression" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("VoiceDashboard call strip", () => {
  it("holds camera, share, activities, soundboard and Leave, never mic or deafen", () => {
    renderDashboard({ isScreenSharing: false, hasCamera: true });
    for (const name of [
      "Turn on camera",
      "Share screen",
      "Activities",
      "Soundboard",
      "Leave call",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deafen" })).toBeNull();
    const solids = Array.from(document.querySelectorAll("button")).filter(
      (button) => button.className.includes("bg-danger-fill"),
    );
    expect(solids).toHaveLength(1);
  });

  it("collapses to its status line while the call's stage is on screen", () => {
    renderDashboard({ isScreenSharing: false, collapsed: true });
    const strip = screen.getByRole("region", { name: "Voice call" });
    expect(strip).toHaveAttribute("data-collapsed");
    expect(strip.querySelector(".rm-collapse")).not.toHaveAttribute(
      "data-open",
    );
    // The collapsed actions are inert, not just hidden.
    expect(strip.querySelector(".rm-collapse-inner")).toHaveAttribute("inert");
  });

  it("says where the call is and what the connection is doing", () => {
    renderDashboard({
      isScreenSharing: false,
      connectionState: "reconnecting",
    });
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });

  it("offers Retry when the connection failed", () => {
    const onRetry = vi.fn();
    renderDashboard({
      isScreenSharing: false,
      connectionState: "failed",
      onRetry,
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("never shows a pulsing signal icon or garbled text", () => {
    renderDashboard({ isScreenSharing: false, connectionState: "connecting" });
    const strip = screen.getByRole("region", { name: "Voice call" });
    expect(strip.innerHTML).not.toContain("animate-pulse");
    expect(strip.textContent).not.toContain("\u00e2\u20ac");
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });
});
