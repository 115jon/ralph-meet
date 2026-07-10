// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StreamContextMenu } from "@/components/StreamContextMenu";
import { useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

import { VoiceGrid } from "../VoiceGrid";
import type { GridItem } from "../types";

vi.mock("@kova/react", () => ({
  useUser: () => ({ user: { id: "viewer" } }),
}));

vi.mock("@/lib/color-utils", () => ({
  extractDominantColor: vi.fn(async () => null),
}));

describe("voice context menu wiring", () => {
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

  it("uses user-targeted submenu handlers for streaming viewer actions", async () => {
    const onOpenProfileUser = vi.fn();
    const onOpenMessageUser = vi.fn();
    const onClose = vi.fn();

    render(
      <StreamContextMenu
        userId="target-user"
        x={40}
        y={40}
        isStreaming
        watchedStreams={{ "target-user": true }}
        onOpenProfileUser={onOpenProfileUser}
        onOpenMessageUser={onOpenMessageUser}
        onClose={onClose}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "More Options" }));

    const messageButton = await screen.findByRole("button", {
      name: "Message",
    });
    fireEvent.click(messageButton);

    expect(onOpenMessageUser).toHaveBeenCalledWith("target-user");
    expect(onClose).toHaveBeenCalled();
  });

  it("toggles viewer audio controls from the streaming menu", async () => {
    render(
      <StreamContextMenu
        userId="target-user"
        x={40}
        y={40}
        isStreaming
        watchedStreams={{ "target-user": true }}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute Soundboard" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Always Hear Stream Audio" }),
    );

    await waitFor(() => {
      const peerSettings = useVoiceSettingsStore
        .getState()
        .getSettings("viewer").peerSettings["target-user"];
      expect(peerSettings?.muted).toBe(true);
      expect(peerSettings?.soundboardMuted).toBe(true);
      expect(peerSettings?.alwaysHear).toBe(true);
    });
  });

  it("forwards profile actions from the focused voice grid context menu", async () => {
    const onOpenProfileUser = vi.fn();
    const item: GridItem = {
      id: "remote-avatar-target",
      userId: "target-user",
      name: "Target User",
      avatar: null,
      avatarDisplay: null,
      stream: null,
      isLocal: false,
      type: "avatar",
      isStreaming: false,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
    };

    render(
      <VoiceGrid
        items={[item]}
        focusedId={item.id}
        onFocus={() => {}}
        globalDeafened={false}
        currentSettings={{ peerSettings: {} }}
        watchedStreams={{}}
        streamThumbnails={{}}
        voiceActions={{ onOpenProfileUser }}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Clear focused participant" }),
    );

    const profileButton = await screen.findByRole("button", {
      name: "Profile",
    });
    fireEvent.click(profileButton);

    await waitFor(() => {
      expect(onOpenProfileUser).toHaveBeenCalledWith("target-user");
    });
  });
});
