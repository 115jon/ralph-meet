// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FloatingStreamPreview from "@/components/chat/FloatingStreamPreview";
import { useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

vi.mock("@kova/react", () => ({
  useUser: () => ({ user: { id: "viewer" } }),
}));

vi.mock("@/components/voice/VideoPlayer", () => ({
  VideoPlayer: () => <div data-testid="video-player" />,
}));

describe("FloatingStreamPreview context menu", () => {
  beforeEach(() => {
    useChatStore.setState({
      members: [],
      channels: [],
      voiceChannelStates: {},
    });
    useVoiceSettingsStore.setState({
      currentUser: "viewer",
      userSettings: {},
      _cache: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the local stream menu from the settings button and forwards actions", async () => {
    const onToggleScreenShare = vi.fn();
    const onToggleAlwaysShowStreamPreview = vi.fn();

    render(
      <FloatingStreamPreview
        userId="viewer"
        channelName="General"
        displayName="You"
        previewStream={null}
        primaryActionTooltip="Stop Streaming"
        primaryActionAriaLabel="Stop streaming"
        onPrimaryAction={() => {}}
        onNavigateToVoiceChannel={() => {}}
        menuProps={{
          isStreaming: true,
          onToggleScreenShare,
          currentScreenQuality: "720p30",
          availableQualities: ["720p30"],
          isStreamingAudio: false,
          onToggleStreamAudio: () => {},
          onChangeSource: () => {},
          showDisconnect: false,
          alwaysShowStreamPreview: false,
          onToggleAlwaysShowStreamPreview,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open stream settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Always Show Stream Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Open stream settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop Streaming" }));

    expect(onToggleAlwaysShowStreamPreview).toHaveBeenCalledTimes(1);
    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it("does not let menu pointer events bubble into the floating preview drag handler", async () => {
    const onToggleAlwaysShowStreamPreview = vi.fn();

    const { container } = render(
      <FloatingStreamPreview
        userId="viewer"
        channelName="General"
        displayName="You"
        previewStream={null}
        primaryActionTooltip="Stop Streaming"
        primaryActionAriaLabel="Stop streaming"
        onPrimaryAction={() => {}}
        onNavigateToVoiceChannel={() => {}}
        menuProps={{
          isStreaming: true,
          onToggleScreenShare: () => {},
          currentScreenQuality: "720p30",
          availableQualities: ["720p30"],
          isStreamingAudio: false,
          onToggleStreamAudio: () => {},
          onChangeSource: () => {},
          showDisconnect: false,
          alwaysShowStreamPreview: false,
          onToggleAlwaysShowStreamPreview,
        }}
      />,
    );

    const previewRoot = container.querySelector(".fixed.z-\\[130\\]") as HTMLDivElement | null;
    expect(previewRoot).not.toBeNull();
    const setPointerCapture = vi.fn();
    if (previewRoot) {
      previewRoot.setPointerCapture = setPointerCapture;
    }

    fireEvent.click(screen.getByRole("button", { name: "Open stream settings" }));
    const menuItem = await screen.findByRole("button", { name: "Always Show Stream Preview" });
    fireEvent.pointerDown(menuItem, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.click(menuItem);

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(onToggleAlwaysShowStreamPreview).toHaveBeenCalledTimes(1);
  });

  it("opens the local stream menu on right click", async () => {
    const onToggleAlwaysShowStreamPreview = vi.fn();

    const { container } = render(
      <FloatingStreamPreview
        userId="viewer"
        channelName="General"
        displayName="You"
        previewStream={null}
        primaryActionTooltip="Stop Streaming"
        primaryActionAriaLabel="Stop streaming"
        onPrimaryAction={() => {}}
        onNavigateToVoiceChannel={() => {}}
        menuProps={{
          isStreaming: true,
          onToggleScreenShare: () => {},
          currentScreenQuality: "720p30",
          availableQualities: ["720p30"],
          isStreamingAudio: false,
          onToggleStreamAudio: () => {},
          onChangeSource: () => {},
          showDisconnect: false,
          alwaysShowStreamPreview: false,
          onToggleAlwaysShowStreamPreview,
        }}
      />,
    );

    const previewRoot = container.querySelector(".fixed.z-\\[130\\]");
    expect(previewRoot).not.toBeNull();
    fireEvent.contextMenu(previewRoot!);

    expect(await screen.findByRole("button", { name: "Always Show Stream Preview" })).toBeTruthy();
  });
});
