// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefetchVoiceChannelJoin = vi.fn();
const prewarmWebRtc = vi.fn();
vi.mock("@/lib/voice/voice-admission-client", () => ({
  prefetchVoiceChannelJoin: (...args: unknown[]) =>
    prefetchVoiceChannelJoin(...args),
}));
vi.mock("@/lib/voice/webrtc-prewarm", () => ({
  prewarmWebRtc: () => prewarmWebRtc(),
}));

import { initialState } from "@/lib/chat-reducer";
import { useChatStore } from "@/stores/chat-store";
import { useActivityStore } from "@/stores/useActivityStore";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

import ChannelSidebar from "../ChannelSidebar";

function sidebar() {
  return React.createElement(ChannelSidebar, {
    channels: [
      {
        id: "vc-1",
        server_id: "srv-1",
        name: "Lounge",
        channel_type: "voice",
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "tc-1",
        server_id: "srv-1",
        name: "general",
        channel_type: "text",
        position: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    categories: [],
    activeChannelId: null,
    serverId: "srv-1",
    serverName: "Ralph HQ",
    onSelect: () => {},
    voiceChannelStates: {},
  });
}

describe("ChannelSidebar voice join intent", () => {
  beforeEach(() => {
    prefetchVoiceChannelJoin.mockClear();
    prewarmWebRtc.mockClear();
    useChatStore.setState(initialState);
    useChatStore.setState({ user: { id: "me", username: "me" } as never });
    useActivityStore.setState({ activeByUser: {} });
    useVoiceSettingsStore.setState({
      currentUser: null,
      userSettings: {},
      _cache: {},
    });
    useListenTogetherStore.setState({ rooms: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    [
      "hovered",
      (row: HTMLElement) => {
        vi.useFakeTimers();
        fireEvent.pointerEnter(row);
        vi.advanceTimersByTime(150);
        vi.useRealTimers();
      },
    ],
    ["pressed", (row: HTMLElement) => fireEvent.pointerDown(row)],
    ["focused", (row: HTMLElement) => fireEvent.focus(row)],
  ])(
    "prefetches the join and warms WebRTC when a voice row is %s",
    (_name, act) => {
      render(sidebar());
      act(screen.getByRole("button", { name: "Open voice channel Lounge" }));

      expect(prefetchVoiceChannelJoin).toHaveBeenCalledWith({
        serverId: "srv-1",
        channelId: "vc-1",
      });
      expect(prewarmWebRtc).toHaveBeenCalled();
    },
  );

  it("ignores a pointer that only sweeps across a voice row", () => {
    vi.useFakeTimers();
    try {
      render(sidebar());
      const row = screen.getByRole("button", {
        name: "Open voice channel Lounge",
      });
      fireEvent.pointerEnter(row);
      vi.advanceTimersByTime(50);
      fireEvent.pointerLeave(row);
      vi.advanceTimersByTime(500);
      expect(prefetchVoiceChannelJoin).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves text channels alone", () => {
    render(sidebar());
    const row = screen.getByRole("button", {
      name: "Open text channel general",
    });
    fireEvent.pointerEnter(row);
    fireEvent.pointerDown(row);
    fireEvent.focus(row);

    expect(prefetchVoiceChannelJoin).not.toHaveBeenCalled();
    expect(prewarmWebRtc).not.toHaveBeenCalled();
  });
});
