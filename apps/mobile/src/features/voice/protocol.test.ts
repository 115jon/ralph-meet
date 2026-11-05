import { describe, expect, it } from "vitest";

import { toIceServers, toTrackInfo, toTrackInfos } from "./protocol";

describe("voice room tracks for the shared media layer", () => {
  it("keeps audio and video, with their SFU names and layers", () => {
    expect(
      toTrackInfo({
        participant_id: "p1",
        track_name: "cam-video-p1",
        sfu_track_name: "sfu-1",
        session_id: "s1",
        kind: "video",
        simulcast_rids: ["f", "h", "q"],
      }),
    ).toEqual({
      participant_id: "p1",
      track_name: "cam-video-p1",
      sfu_track_name: "sfu-1",
      session_id: "s1",
      kind: "video",
      simulcast_rids: ["f", "h", "q"],
    });
  });

  it("drops kinds the media layer cannot pull", () => {
    expect(
      toTrackInfos([
        {
          participant_id: "p",
          track_name: "a",
          session_id: "s",
          kind: "audio",
        },
        { participant_id: "p", track_name: "d", session_id: "s", kind: "data" },
      ]).map((track) => track.track_name),
    ).toEqual(["a"]);
  });

  it("gives every ICE server a list of URLs", () => {
    expect(
      toIceServers([
        { urls: "stun:a" },
        { urls: ["turn:b"], username: "u", credential: "c" },
      ]),
    ).toEqual([
      { urls: ["stun:a"] },
      { urls: ["turn:b"], username: "u", credential: "c" },
    ]);
    expect(toIceServers(undefined)).toEqual([]);
  });
});
