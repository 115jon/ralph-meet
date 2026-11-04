// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Channel } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";

import { ChatHeader } from "../ChatHeader";
import { ChatWelcomeContent } from "../ChatWelcomeContent";

vi.mock("../NotificationBell", () => ({
  NotificationBell: () => null,
}));

const voiceChannel: Channel = {
  id: "ch-voice",
  server_id: "s-1",
  name: "Lounge",
  channel_type: "voice",
  position: 0,
  created_at: "2026-01-01T00:00:00Z",
};

const textChannel: Channel = {
  ...voiceChannel,
  id: "ch-text",
  name: "general",
  channel_type: "text",
};

function renderHeader(onClose?: () => void) {
  return render(
    <TooltipProvider>
      <ChatHeader
        channelName="Lounge"
        channelId="ch-voice"
        memberCount={3}
        showChannelDetails={false}
        onToggleChannelDetails={() => {}}
        onMenuClick={() => {}}
        handleTogglePins={() => {}}
        pinButtonRef={createRef<HTMLButtonElement>()}
        pinnedCount={0}
        showPins={false}
        onOpenSearch={() => {}}
        onClose={onClose}
      />
    </TooltipProvider>,
  );
}

describe("voice channel chat panel", () => {
  afterEach(() => {
    cleanup();
    useChatStore.setState({ channels: [] });
  });

  it("swaps the 224px search field for a search key in the docked panel", () => {
    useChatStore.setState({ channels: [voiceChannel] });
    renderHeader(() => {});

    // The field (a button titled "Search messages") is gone; one search key
    // and the close key remain.
    expect(screen.queryByTitle("Search messages")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Close chat" }),
    ).toBeInTheDocument();
  });

  it("keeps the search field in the full-width channel header", () => {
    useChatStore.setState({ channels: [voiceChannel] });
    renderHeader();

    expect(screen.getByTitle("Search messages")).toBeInTheDocument();
  });

  it("introduces a voice channel's chat without a text-channel #", () => {
    useChatStore.setState({ channels: [voiceChannel] });
    render(
      <ChatWelcomeContent
        isDM={false}
        channelName="Lounge"
        channelId="ch-voice"
      />,
    );

    expect(screen.getByRole("heading", { name: "Lounge" })).toBeInTheDocument();
    expect(
      screen.getByText("This is the start of the Lounge chat."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/#Lounge/)).toBeNull();
  });

  it("keeps the # intro for a text channel", () => {
    useChatStore.setState({ channels: [textChannel] });
    render(
      <ChatWelcomeContent
        isDM={false}
        channelName="general"
        channelId="ch-text"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "#general" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This is the start of #general."),
    ).toBeInTheDocument();
  });
});
