import { describe, expect, it } from "vitest";

import {
  isReconnectWithinGrace,
  shouldKeepResumableSession,
} from "../src/lib/voice/connection-generation";
import { filterVoiceChannelStatesPayload } from "../src/lib/voice-channel-state-filter";
import { ProfileRequestCoordinator } from "./meeting-room/profile-request-coordinator";

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

describe("meeting room resume helpers", () => {
  it("expires resumable sessions at the grace boundary", () => {
    expect(isReconnectWithinGrace(10_000, 129_999, 120_000)).toBe(true);
    expect(isReconnectWithinGrace(10_000, 130_000, 120_000)).toBe(false);
  });

  it("keeps resumable sessions only for non-intentional disconnects", () => {
    expect(shouldKeepResumableSession(false)).toBe(true);
    expect(shouldKeepResumableSession(true)).toBe(false);
  });
});

describe("profile request coordination", () => {
  it("rejects an older success after a newer request fails", () => {
    const coordinator = new ProfileRequestCoordinator();
    const older = coordinator.begin("user-1");
    const newer = coordinator.begin("user-1");

    // Generation two failed before generation one completed. The older
    // response must not publish over the latest issued request.
    expect(newer.generation).toBe(2);
    expect(coordinator.isCurrent(newer)).toBe(true);
    expect(coordinator.isCurrent(older)).toBe(false);
    expect(coordinator.acceptSuccess(older)).toBe(false);
  });

  it("keeps a newer successful identity ahead of an older response", () => {
    const coordinator = new ProfileRequestCoordinator();
    const older = coordinator.begin("user-1");
    const newer = coordinator.begin("user-1");

    expect(coordinator.acceptSuccess(newer)).toBe(true);
    expect(coordinator.acceptSuccess(older)).toBe(false);
  });
});
