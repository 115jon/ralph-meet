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

  it("renders the split voice channel status controls only for members currently in that voice channel", () => {
    useChatStore.setState({
      user: { id: "u1", username: "alice" },
    });

    const mediaStatus = {
      id: "media-1",
      provider: "external",
      title: "Party Loop",
      preview_url: "https://example.com/party-loop.gif",
      preview_width: 640,
      preview_height: 360,
      preview_content_type: "image/gif" as const,
    };

    const visibleMarkup = renderToStaticMarkup(
      React.createElement(ChannelSidebar, {
        channels: [
          {
            id: "vc-1",
            server_id: "srv-1",
            name: "Standup",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
            voice_status: {
              text: "Sprint planning in progress",
              media: mediaStatus,
            },
          },
        ],
        categories: [],
        activeChannelId: null,
        serverId: "srv-1",
        serverName: "Server",
        currentUserId: "u1",
        onSelect: () => {},
        localVoiceChannelId: "vc-1",
        localVoiceConnected: true,
        localVoiceSessionId: "session-1",
        voiceChannelStates: {
          "vc-1": [
            {
              clerk_user_id: "u1",
              name: "Alice",
              username: "alice",
              display_name: "Alice",
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

    const hiddenMarkup = renderToStaticMarkup(
      React.createElement(ChannelSidebar, {
        channels: [
          {
            id: "vc-1",
            server_id: "srv-1",
            name: "Standup",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
            voice_status: {
              text: "Sprint planning in progress",
              media: mediaStatus,
            },
          },
        ],
        categories: [],
        activeChannelId: null,
        serverId: "srv-1",
        serverName: "Server",
        currentUserId: "u1",
        onSelect: () => {},
        localVoiceChannelId: "vc-1",
        localVoiceConnected: false,
        localVoiceSessionId: null,
        voiceChannelStates: {
          "vc-1": [
            {
              clerk_user_id: "u1",
              name: "Alice",
              username: "alice",
              display_name: "Alice",
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

    expect(visibleMarkup).toContain("Sprint planning in progress");
    expect(visibleMarkup).toContain("Change media");
    expect(visibleMarkup).toContain("Remove media");
    expect(visibleMarkup).not.toContain("Channel vibe");
    expect(visibleMarkup).not.toContain("Party Loop");
    // When not in the voice channel the editable status block is not rendered
    expect(hiddenMarkup).not.toContain("Change media");
    expect(hiddenMarkup).not.toContain("Remove media");
  });

  it("shows voice channel status as read-only for observers not in the voice channel", () => {
    useChatStore.setState({
      user: { id: "observer", username: "bob" },
    });

    const mediaStatus = {
      id: "media-2",
      provider: "external",
      title: "Chill Beats",
      preview_url: "https://example.com/chill.gif",
      preview_width: 480,
      preview_height: 270,
      preview_content_type: "image/gif" as const,
    };

    // Observer: different user, not connected to this voice channel
    const observerMarkup = renderToStaticMarkup(
      React.createElement(ChannelSidebar, {
        channels: [
          {
            id: "vc-1",
            server_id: "srv-1",
            name: "Standup",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
            voice_status: {
              text: "Design sync happening now",
              media: mediaStatus,
            },
          },
        ],
        categories: [],
        activeChannelId: null,
        serverId: "srv-1",
        serverName: "Server",
        currentUserId: "observer",
        onSelect: () => {},
        // Observer is not in any voice channel
        localVoiceChannelId: null,
        localVoiceConnected: false,
        localVoiceSessionId: null,
        voiceChannelStates: {
          "vc-1": [
            {
              clerk_user_id: "u1",
              name: "Alice",
              username: "alice",
              display_name: "Alice",
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

    // Status content should be visible to observers
    expect(observerMarkup).toContain("Design sync happening now");
    // Media should be rendered (via the preview_url in an img/video src)
    expect(observerMarkup).toContain("chill.gif");
    // Edit controls must NOT appear for observers
    expect(observerMarkup).not.toContain("Change media");
    expect(observerMarkup).not.toContain("Remove media");
    expect(observerMarkup).not.toContain("aria-label=\"Change media\"");
    expect(observerMarkup).not.toContain("aria-label=\"Remove media\"");
    // The editable text trigger (Edit2 pencil) should not appear
    expect(observerMarkup).not.toContain("Set a channel status");
  });

  it("hides read-only voice channel status when no members are present in the channel", () => {
    useChatStore.setState({
      user: { id: "observer", username: "bob" },
    });

    const emptyChannelMarkup = renderToStaticMarkup(
      React.createElement(ChannelSidebar, {
        channels: [
          {
            id: "vc-1",
            server_id: "srv-1",
            name: "Standup",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
            voice_status: {
              text: "Leftover status from last session",
              media: null,
            },
          },
        ],
        categories: [],
        activeChannelId: null,
        serverId: "srv-1",
        serverName: "Server",
        currentUserId: "observer",
        onSelect: () => {},
        localVoiceChannelId: null,
        localVoiceConnected: false,
        localVoiceSessionId: null,
        // No members present
        voiceChannelStates: { "vc-1": [] },
      }),
    );

    // Status must not be visible when the channel is empty
    expect(emptyChannelMarkup).not.toContain("Leftover status from last session");
  });
});
