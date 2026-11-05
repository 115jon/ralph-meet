// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefetchVoiceChannelJoin = vi.fn();
vi.mock("@/lib/voice/voice-admission-client", () => ({
  prefetchVoiceChannelJoin: (...args: unknown[]) =>
    prefetchVoiceChannelJoin(...args),
}));
vi.mock("@/lib/voice/webrtc-prewarm", () => ({ prewarmWebRtc: () => {} }));

import { initialState } from "@/lib/chat-reducer";
import { PERMISSIONS } from "@/lib/permissions";
import type { Channel } from "@/lib/types";
import type { VoiceChannelMember } from "@/stores/chat-store";
import { useChatStore } from "@/stores/chat-store";
import { useActivityStore } from "@/stores/useActivityStore";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

import ChannelSidebar from "../ChannelSidebar";
import { voiceMoveTargets } from "../voice-move-targets";

const MOD =
  PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT | PERMISSIONS.MOVE_MEMBERS;
const MEMBER = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT;

function channel(
  id: string,
  name: string,
  channel_type: "voice" | "text",
  permissions: number,
  position: number,
): Channel {
  return {
    id,
    server_id: "srv-1",
    name,
    channel_type,
    position,
    permissions,
    created_at: "2026-01-01T00:00:00Z",
  } as Channel;
}

const sam: VoiceChannelMember = {
  user_id: "sam",
  name: "Sam",
  self_mute: false,
  self_deaf: false,
  self_video: false,
  self_stream: false,
} as VoiceChannelMember;

function sidebar(sourcePermissions = MOD) {
  return React.createElement(ChannelSidebar, {
    channels: [
      channel("vc-a", "General", "voice", sourcePermissions, 0),
      channel("vc-b", "Lounge", "voice", MOD, 1),
      channel("vc-c", "Quiet", "voice", MEMBER, 2),
      channel("tc-1", "chat", "text", MOD, 3),
    ],
    categories: [],
    activeChannelId: null,
    serverId: "srv-1",
    serverName: "Ralph HQ",
    currentUserId: "me",
    onSelect: () => {},
    voiceChannelStates: { "vc-a": [sam] },
  });
}

function rowOf(name: string, kind: "voice" | "text" = "voice") {
  const button = screen.getByRole("button", {
    name: `Open ${kind} channel ${name}`,
  });
  return button.parentElement as HTMLElement;
}

function startDraggingSam() {
  const samRow = screen.getByRole("button", { name: "Open profile for Sam" });
  fireEvent.mouseDown(samRow, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
}

describe("ChannelSidebar voice member moves", () => {
  beforeEach(() => {
    prefetchVoiceChannelJoin.mockClear();
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

  it("lets a viewer with MOVE_MEMBERS drag a member, lighting valid targets only", () => {
    render(sidebar());
    const samRow = screen.getByRole("button", { name: "Open profile for Sam" });
    expect(samRow).toHaveAttribute("data-voice-draggable");
    for (const name of ["General", "Lounge", "Quiet"]) {
      expect(rowOf(name)).not.toHaveAttribute("data-drop-target");
    }

    startDraggingSam();

    // Lounge: MOVE_MEMBERS there. General is Sam's own channel, Quiet has no
    // MOVE_MEMBERS, and text channels never take members.
    expect(rowOf("Lounge")).toHaveAttribute("data-drop-target", "valid");
    expect(rowOf("General")).not.toHaveAttribute("data-drop-target");
    expect(rowOf("Quiet")).not.toHaveAttribute("data-drop-target");
    expect(rowOf("chat", "text")).not.toHaveAttribute("data-drop-target");

    fireEvent.mouseUp(document);
    expect(rowOf("Lounge")).not.toHaveAttribute("data-drop-target");
  });

  it("keeps hover join prefetch off while a member is dragged", () => {
    vi.useFakeTimers();
    try {
      render(sidebar());
      startDraggingSam();
      const lounge = screen.getByRole("button", {
        name: "Open voice channel Lounge",
      });
      fireEvent.pointerEnter(lounge);
      vi.advanceTimersByTime(500);
      expect(prefetchVoiceChannelJoin).not.toHaveBeenCalled();
    } finally {
      fireEvent.mouseUp(document);
      vi.useRealTimers();
    }
  });

  it("offers no drag without MOVE_MEMBERS in the member's channel", () => {
    render(sidebar(MEMBER));
    const samRow = screen.getByRole("button", { name: "Open profile for Sam" });
    expect(samRow).not.toHaveAttribute("data-voice-draggable");

    startDraggingSam();
    expect(rowOf("Lounge")).not.toHaveAttribute("data-drop-target");
  });
});

describe("voiceMoveTargets (the Move to list)", () => {
  const channels = [
    channel("vc-a", "General", "voice", MOD, 0),
    channel("vc-c", "Quiet", "voice", MEMBER, 2),
    channel("vc-b", "Lounge", "voice", MOD, 1),
    channel("tc-1", "chat", "text", MOD, 3),
  ];

  it("lists the other voice channels the viewer may move members into", () => {
    expect(
      voiceMoveTargets(
        channels,
        { userId: "sam", channelId: "vc-a" },
        "me",
      ).map((c) => c.name),
    ).toEqual(["Lounge"]);
  });

  it("is empty for your own row and without MOVE_MEMBERS at the source", () => {
    expect(
      voiceMoveTargets(channels, { userId: "me", channelId: "vc-a" }, "me"),
    ).toEqual([]);
    expect(
      voiceMoveTargets(channels, { userId: "sam", channelId: "vc-c" }, "me"),
    ).toEqual([]);
  });
});
