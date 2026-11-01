import { describe, expect, it } from "vitest";

import {
  clipSource,
  decodeSoundboardEvent,
  DM_CALL_SERVER_KEY,
  eventOwner,
  playableIn,
  playbackId,
  playbackOwner,
  playPayload,
  type PlayableSound,
  type SoundboardPlay,
} from "./events";

const upload: PlayableSound = {
  id: "snd 1",
  name: "air horn",
  emoji: null,
  kind: "server",
  url: "/api/soundboard/uploads/snd%201",
  volume: 0.5,
  serverId: "srv",
};

function play(fields: Partial<SoundboardPlay>): SoundboardPlay {
  return {
    type: "soundboard.play",
    server_key: "srv",
    playback_id: playbackId("u1", "x"),
    ...fields,
  };
}

describe("playback ids", () => {
  it("round-trips the owner, ids with colons included", () => {
    const id = playbackId("user:42", "snd");
    expect(id).toBe("sb1:7:user:42:snd");
    expect(playbackOwner(id)).toBe("user:42");
  });

  it("rejects ids that are not the web's format", () => {
    expect(playbackOwner("nope")).toBeNull();
    expect(playbackOwner("sb1:9:short:x")).toBeNull();
  });
});

describe("playPayload", () => {
  it("sends an upload in a voice channel with its path and scaled volume", () => {
    expect(playPayload(upload, "srv", "u1")).toEqual({
      type: "soundboard.play",
      server_key: "srv",
      user_id: "u1",
      playback_id: "sb1:2:u1:snd 1",
      sound_id: "snd 1",
      name: "air horn",
      volume: 0.4,
      media_url: "/api/soundboard/uploads/snd%201",
    });
  });

  it("names the source server for an upload in a DM call", () => {
    const d = playPayload(upload, DM_CALL_SERVER_KEY, "u1");
    expect(d.source_server_id).toBe("srv");
    expect(d.server_key).toBe(DM_CALL_SERVER_KEY);
  });

  it("sends a default sound by id alone", () => {
    const d = playPayload(
      {
        id: "ping",
        name: "Ping",
        emoji: null,
        kind: "default",
        url: null,
        volume: 1,
        serverId: null,
      },
      "srv",
      "u1",
    );
    expect(d.media_url).toBeUndefined();
    expect(d.sound_id).toBe("ping");
  });
});

describe("playableIn", () => {
  it("keeps other servers' uploads out of a voice channel", () => {
    expect(playableIn(upload, "srv")).toBe(true);
    expect(playableIn(upload, "other")).toBe(false);
  });

  it("allows only uploads and defaults in a DM call", () => {
    expect(playableIn(upload, DM_CALL_SERVER_KEY)).toBe(true);
    expect(
      playableIn(
        { ...upload, kind: "myinstants", serverId: null },
        DM_CALL_SERVER_KEY,
      ),
    ).toBe(false);
  });
});

describe("incoming events", () => {
  it("decodes a play and ignores other app events", () => {
    expect(
      decodeSoundboardEvent({
        type: "soundboard.play",
        server_key: "srv",
        playback_id: "sb1:2:u1:x",
        volume: 0.8,
        sent_at: 1,
      }),
    ).toMatchObject({ type: "soundboard.play", volume: 0.8 });
    expect(decodeSoundboardEvent({ type: "listen_together.enqueue" })).toBe(
      null,
    );
    expect(decodeSoundboardEvent({ type: "soundboard.play" })).toBe(null);
  });

  it("finds the owner from the playback id when user_id is missing", () => {
    expect(eventOwner(play({}))).toBe("u1");
    expect(eventOwner(play({ user_id: "u9" }))).toBe("u9");
  });

  it("resolves where the clip comes from", () => {
    expect(
      clipSource(play({ media_url: "/api/soundboard/uploads/a" })),
    ).toEqual({ kind: "api", path: "/api/soundboard/uploads/a" });
    expect(
      clipSource(
        play({ media_url: "/api/soundboard/uploads/a?cap=t&room_slug=r" }),
      ),
    ).toMatchObject({ kind: "url", apiRelative: true });
    expect(
      clipSource(
        play({ media_url: "https://www.myinstants.com/media/sounds/b.mp3" }),
      ),
    ).toMatchObject({ kind: "url", apiRelative: false });
    expect(clipSource(play({ sound_id: "tada" }))).toEqual({
      kind: "default",
      id: "tada",
    });
    expect(clipSource(play({ media_url: "https://evil.example/x" }))).toBe(
      null,
    );
  });
});
