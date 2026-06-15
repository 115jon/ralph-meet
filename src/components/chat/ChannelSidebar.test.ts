import { initialState } from "@/lib/chat-reducer";
import { useChatStore } from "@/stores/chat-store";
import { useVoiceActivityStore } from "@/stores/useVoiceActivityStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import ChannelSidebar from "./ChannelSidebar";

describe("ChannelSidebar voice member identities", () => {
  beforeEach(() => {
    useChatStore.setState(initialState);
    useVoiceActivityStore.setState({ activeByUser: {} });
    useVoiceSettingsStore.setState({ currentUser: null, userSettings: {}, _cache: {} });
  });

  it("renders the latest display name for voice channel members", () => {
    useChatStore.setState({
      user: { id: "me", username: "me" },
    });

    const markup = renderToStaticMarkup(
      React.createElement(ChannelSidebar, {
        channels: [
          {
            id: "vc-1",
            server_id: "srv-1",
            name: "Standup",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        categories: [],
        activeChannelId: null,
        serverId: "srv-1",
        serverName: "Server",
        onSelect: () => {},
        voiceChannelStates: {
          "vc-1": [
            {
              clerk_user_id: "u1",
              name: "Legacy Name",
              username: "alice",
              display_name: "Alice Display",
              avatar_url: null,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          ],
        },
      }),
    );

    expect(markup).toContain("Alice Display");
    expect(markup).not.toContain("Legacy Name");
  });

  it("marks reconnecting voice members for faded Discord-style rendering", () => {
    useChatStore.setState({
      user: { id: "me", username: "me" },
    });

    const markup = renderToStaticMarkup(
      React.createElement(ChannelSidebar, {
        channels: [
          {
            id: "vc-1",
            server_id: "srv-1",
            name: "Standup",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        categories: [],
        activeChannelId: null,
        serverId: "srv-1",
        serverName: "Server",
        onSelect: () => {},
        voiceChannelStates: {
          "vc-1": [
            {
              clerk_user_id: "u1",
              name: "Alice",
              username: "alice",
              display_name: null,
              avatar_url: null,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
              connected: false,
              connection_state: "reconnecting",
              disconnected_at: 1_000,
              reconnect_expires_at: 121_000,
            },
          ],
        },
      }),
    );

    expect(markup).toContain('data-voice-connection-state="reconnecting"');
    expect(markup).not.toContain("Reconnecting");
  });

  it("marks the current user's server-side voice membership stale when this tab is not locally joined", () => {
    useChatStore.setState({
      user: { id: "u1", username: "alice" },
    });

    const markup = renderToStaticMarkup(
      React.createElement(ChannelSidebar, {
        channels: [
          {
            id: "vc-1",
            server_id: "srv-1",
            name: "Standup",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        categories: [],
        activeChannelId: null,
        serverId: "srv-1",
        serverName: "Server",
        currentUserId: "u1",
        onSelect: () => {},
        localVoiceChannelId: null,
        localVoiceConnected: false,
        voiceChannelStates: {
          "vc-1": [
            {
              clerk_user_id: "u1",
              name: "Alice",
              username: "alice",
              display_name: null,
              avatar_url: null,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
              connected: true,
              connection_state: "connected",
            },
          ],
        },
      }),
    );

    expect(markup).toContain('data-voice-connection-state="reconnecting"');
    expect(markup).not.toContain("Reconnecting");
  });
});
