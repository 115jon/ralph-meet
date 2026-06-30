import { describe, expect, it } from "vitest";

import { buildRoomLink, copyRoomLink } from "./room-links";

describe("buildRoomLink", () => {
  it("builds an absolute link to a standalone room", () => {
    expect(buildRoomLink("release room", "https://meet.example/")).toBe(
      "https://meet.example/room/release%20room",
    );
  });

  it("copies a standalone room link to the provided clipboard", async () => {
    const writes: string[] = [];

    await copyRoomLink("alpha", {
      origin: "https://meet.example",
      clipboard: {
        writeText: async (value: string) => {
          writes.push(value);
        },
      },
    });

    expect(writes).toEqual(["https://meet.example/room/alpha"]);
  });
});
