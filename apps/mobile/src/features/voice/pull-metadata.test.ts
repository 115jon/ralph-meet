import { describe, expect, it } from "vitest";

import { toPartyTracksMetadata } from "./pull-metadata";

const camera = {
  participant_id: "publisher",
  track_name: "cam-video-publisher",
  sfu_track_name: "sfu-camera",
  session_id: "capability",
  kind: "video",
};

describe("toPartyTracksMetadata", () => {
  it("pulls a simulcast camera at its top layer", () => {
    expect(
      toPartyTracksMetadata({ ...camera, simulcast_rids: ["f", "h", "q"] }),
    ).toEqual({
      location: "remote",
      trackName: "sfu-camera",
      sessionId: "capability",
      simulcast: { preferredRid: "f" },
    });
  });

  it("pulls a single-layer track without naming a layer", () => {
    expect(toPartyTracksMetadata(camera)).toEqual({
      location: "remote",
      trackName: "sfu-camera",
      sessionId: "capability",
    });
    expect(
      toPartyTracksMetadata({ ...camera, simulcast_rids: ["f"] }),
    ).not.toHaveProperty("simulcast");
  });
});
