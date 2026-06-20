import { describe, expect, it } from "vitest";

import { filterVoiceChannelStatesPayload } from "../src/lib/voice-channel-state-filter";

describe("filterVoiceChannelStatesPayload", () => {
  it("keeps only visible voice channels in the snapshot", () => {
    const filtered = filterVoiceChannelStatesPayload(
      {
        voice_states: {
          "vc-visible": [
            {
              clerk_user_id: "user-1",
              name: "Alice",
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
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          ],
        },
        voice_started_at: {
          "vc-visible": 123,
          "vc-hidden": 456,
        },
        spatial_audio_states: {
          "vc-visible": {
            enabled: true,
            placementMode: "line",
            roomSize: 10,
            distance: 4,
            arcAngle: 90,
            manualPositions: {},
            updatedAt: 123,
          },
          "vc-hidden": {
            enabled: true,
            placementMode: "grid",
            roomSize: 8,
            distance: 3,
            arcAngle: 60,
            manualPositions: {},
            updatedAt: 456,
          },
        },
      },
      ["vc-visible"],
    );

    expect(filtered).toEqual({
      voice_states: {
        "vc-visible": [
          {
            clerk_user_id: "user-1",
            name: "Alice",
            self_mute: false,
            self_deaf: false,
            self_video: false,
            self_stream: false,
          },
        ],
      },
      voice_started_at: {
        "vc-visible": 123,
      },
      spatial_audio_states: {
        "vc-visible": {
          enabled: true,
          placementMode: "line",
          roomSize: 10,
          distance: 4,
          arcAngle: 90,
          manualPositions: {},
          updatedAt: 123,
        },
      },
    });
  });
});
