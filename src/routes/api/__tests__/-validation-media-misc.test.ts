import { describe, expect, it } from "vitest";

import { validateBody } from "@/lib/validate-body";
import { gifFavoriteBodySchema } from "../gifs";
import { generateEmojiBodySchema } from "../emojis";
import { listenTogetherResolveBodySchema } from "../listen-together/resolve";
import { myInstantsFavoriteBodySchema } from "../myinstants/favorites";
import { socketTicketRequestBodySchema } from "../voice/socket-ticket";

function jsonRequest(body: string): Request {
  return new Request("https://meet.test/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("media and miscellaneous request body validation", () => {
  it.each([
    ["GIF favorites", gifFavoriteBodySchema],
    ["emoji generation", generateEmojiBodySchema],
    ["listen together resolution", listenTogetherResolveBodySchema],
    ["MyInstants favorites", myInstantsFavoriteBodySchema],
    ["socket tickets", socketTicketRequestBodySchema],
  ])("rejects malformed JSON for %s with a 400", async (_name, schema) => {
    const result = await validateBody(jsonRequest("{not json"), schema);

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("expected Response");
    expect(result.status).toBe(400);
  });

  it.each([
    ["GIF favorites", gifFavoriteBodySchema, { favorites: "not-an-array" }],
    ["emoji generation", generateEmojiBodySchema, []],
    [
      "listen together resolution",
      listenTogetherResolveBodySchema,
      { roomSlug: 123 },
    ],
    [
      "MyInstants favorites",
      myInstantsFavoriteBodySchema,
      { action: "add", sound: "not-an-object" },
    ],
    ["socket tickets", socketTicketRequestBodySchema, null],
  ])(
    "rejects structurally invalid %s bodies with a 400",
    async (_name, schema, body) => {
      const result = await validateBody(
        jsonRequest(JSON.stringify(body)),
        schema,
      );

      expect(result).toBeInstanceOf(Response);
      if (!(result instanceof Response)) throw new Error("expected Response");
      expect(result.status).toBe(400);
    },
  );

  it.each([
    [
      "GIF favorites",
      gifFavoriteBodySchema,
      {
        favorite: {
          id: "gif-1",
          provider: "tenor",
          sourceUrl: "https://media.example/gif-1.gif",
          preview: { url: "https://media.example/gif-1.gif" },
          send: { url: "https://media.example/gif-1.gif" },
        },
      },
    ],
    ["emoji generation", generateEmojiBodySchema, { prompt: "a cat" }],
    [
      "listen together resolution",
      listenTogetherResolveBodySchema,
      {
        roomSlug: "room-1",
        serverId: null,
        channelId: "channel-1",
        url: "https://example.com/media",
      },
    ],
    [
      "MyInstants favorites",
      myInstantsFavoriteBodySchema,
      {
        action: "add",
        sound: {
          id: "sound-1",
          title: "Sound",
          url: "https://example.com/sound.mp3",
          color: "#fff",
          soundType: "myinstants",
          emoji: "sound",
        },
      },
    ],
    [
      "socket tickets",
      socketTicketRequestBodySchema,
      { audience: "room", roomSlug: "demo-room" },
    ],
  ])(
    "accepts representative valid %s structures",
    async (_name, schema, body) => {
      const result = await validateBody(
        jsonRequest(JSON.stringify(body)),
        schema,
      );

      expect(result).not.toBeInstanceOf(Response);
    },
  );

  it("accepts unknown-typed emoji and socket ticket fields", async () => {
    const emojiResult = await validateBody(
      jsonRequest(JSON.stringify({ prompt: 123, shortcode: { value: true } })),
      generateEmojiBodySchema,
    );
    const socketResult = await validateBody(
      jsonRequest(
        JSON.stringify({
          audience: 123,
          channelId: null,
          roomSlug: { value: "demo-room" },
          serverId: false,
        }),
      ),
      socketTicketRequestBodySchema,
    );

    expect(emojiResult).not.toBeInstanceOf(Response);
    expect(socketResult).not.toBeInstanceOf(Response);
  });
});
