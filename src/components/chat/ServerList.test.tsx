import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ServerList from "./ServerList";

describe("ServerList voice activity", () => {
  it("renders the voice indicator and detailed hover card for visible voice channels", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ServerList, {
        servers: [
          {
            id: "srv-1",
            name: "Dev Environment",
            owner_id: "owner-1",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        activeServerId: null,
        onSelect: () => {},
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
        channelsByServerId: {
          "srv-1": [
            {
              id: "vc-1",
              server_id: "srv-1",
              name: "Standup",
              channel_type: "voice",
              position: 0,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        },
        voiceChannelStates: {
          "vc-1": [
            {
              clerk_user_id: "user-1",
              name: "Alice",
              display_name: "Alice",
              avatar_url: null,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          ],
        },
        localVoiceServerId: "srv-1",
      }),
    );

    expect(markup).toContain('data-server-voice-indicator="true"');
    expect(markup).toContain('data-local-voice="true"');
    expect(markup).toContain('data-server-tooltip="voice"');
    expect(markup).toContain("Dev Environment");
    expect(markup).toContain("Standup");
    expect(markup).toContain("1 person across 1 channel");
  });

  it("ignores hidden voice-state channels that are not present in the visible channel list", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ServerList, {
        servers: [
          {
            id: "srv-1",
            name: "Dev Environment",
            owner_id: "owner-1",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        activeServerId: null,
        onSelect: () => {},
        channels: [
          {
            id: "vc-visible",
            server_id: "srv-1",
            name: "Public Room",
            channel_type: "voice",
            position: 0,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        channelsByServerId: {
          "srv-1": [
            {
              id: "vc-visible",
              server_id: "srv-1",
              name: "Public Room",
              channel_type: "voice",
              position: 0,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        },
        voiceChannelStates: {
          "vc-visible": [
            {
              clerk_user_id: "user-1",
              name: "Alice",
              avatar_url: null,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          ],
          "vc-hidden": [
            {
              clerk_user_id: "user-2",
              name: "Bob",
              avatar_url: null,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
            {
              clerk_user_id: "user-3",
              name: "Casey",
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

    expect(markup).toContain("Public Room");
    expect(markup).toContain("1 person across 1 channel");
    expect(markup).not.toContain("3 people across 2 channels");
  });
});
