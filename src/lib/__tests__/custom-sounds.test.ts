import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  createIdbCustomSoundStorage,
  CUSTOM_SOUND_LIMITS,
  customSoundFileNames,
  soundIdForFilename,
  validateCustomSound,
  type CustomSoundFile,
  type CustomSoundRecord,
} from "../custom-sounds";
import { SOUND_IDS } from "../sound-catalog";

function audioFile(
  name: string,
  { type = "audio/mpeg", size = 1000 }: { type?: string; size?: number } = {},
): CustomSoundFile {
  return {
    name,
    type,
    size,
    arrayBuffer: async () => new Uint8Array(Math.min(size, 16)).buffer,
  };
}

const decodesTo = (seconds: number) => async () => seconds;
const neverDecodes = async () => {
  throw new DOMException("Unable to decode audio data", "EncodingError");
};

describe("filename matching", () => {
  it.each([
    ["voice-join.mp3", "voiceJoin"],
    ["voiceJoin.wav", "voiceJoin"],
    ["Voice_Join.OGG", "voiceJoin"],
    ["outgoing ring.m4a", "outgoingRing"],
    ["stream-watcher-stop.opus", "streamWatcherStop"],
    ["ring", "ring"],
  ])("%s -> %s", (name, id) => {
    expect(soundIdForFilename(name)).toBe(id);
  });

  it.each(["join.mp3", "voice-join-2.mp3", "notify.wav", ""])(
    "%s matches nothing",
    (name) => {
      expect(soundIdForFilename(name)).toBeNull();
    },
  );

  it("documents a file name for every sound that maps back to it", () => {
    const names = customSoundFileNames();
    expect(names.map((n) => n.id)).toEqual([...SOUND_IDS]);
    for (const { id, file } of names) {
      expect(file).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(soundIdForFilename(`${file}.mp3`)).toBe(id);
    }
  });
});

describe("validation", () => {
  it("accepts a short audio file and records what it is", async () => {
    const result = await validateCustomSound(
      "mute",
      audioFile("pop.mp3"),
      decodesTo(0.4),
      () => 42,
    );
    expect(result).toMatchObject({
      ok: true,
      record: {
        id: "mute",
        name: "pop.mp3",
        type: "audio/mpeg",
        size: 1000,
        duration: 0.4,
        updatedAt: 42,
      },
    });
  });

  it("rejects files that aren't audio", async () => {
    const result = await validateCustomSound(
      "mute",
      audioFile("notes.txt", { type: "text/plain" }),
      decodesTo(0.4),
    );
    expect(result).toMatchObject({ ok: false, error: "type" });
  });

  it("accepts known audio extensions with an empty MIME type", async () => {
    const result = await validateCustomSound(
      "mute",
      audioFile("pop.opus", { type: "" }),
      decodesTo(0.4),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects empty and oversized files before decoding", async () => {
    let decoded = false;
    const decode = async () => {
      decoded = true;
      return 1;
    };
    expect(
      await validateCustomSound(
        "mute",
        audioFile("a.mp3", { size: 0 }),
        decode,
      ),
    ).toMatchObject({ ok: false, error: "empty" });
    expect(
      await validateCustomSound(
        "mute",
        audioFile("a.mp3", { size: CUSTOM_SOUND_LIMITS.maxBytes + 1 }),
        decode,
      ),
    ).toMatchObject({ ok: false, error: "size" });
    expect(decoded).toBe(false);
  });

  it("rejects data the browser can't decode", async () => {
    const result = await validateCustomSound(
      "mute",
      audioFile("fake.mp3"),
      neverDecodes,
    );
    expect(result).toMatchObject({ ok: false, error: "decode" });
  });

  it("caps one-shots at 5 seconds and rings at 15", async () => {
    expect(
      await validateCustomSound("mute", audioFile("a.mp3"), decodesTo(5)),
    ).toMatchObject({ ok: true });
    expect(
      await validateCustomSound("mute", audioFile("a.mp3"), decodesTo(5.1)),
    ).toMatchObject({ ok: false, error: "duration" });
    expect(
      await validateCustomSound("ring", audioFile("a.mp3"), decodesTo(15)),
    ).toMatchObject({ ok: true });
    expect(
      await validateCustomSound(
        "outgoingRing",
        audioFile("a.mp3"),
        decodesTo(15.5),
      ),
    ).toMatchObject({ ok: false, error: "duration" });
  });

  it("decodes a copy so the stored bytes stay usable", async () => {
    let seen: ArrayBuffer | null = null;
    const result = await validateCustomSound(
      "mute",
      audioFile("a.mp3"),
      async (bytes) => {
        seen = bytes;
        return 1;
      },
    );
    expect(result.ok && result.record.bytes).not.toBe(seen);
  });
});

describe("IndexedDB storage", () => {
  const record = (
    id: CustomSoundRecord["id"],
    byte: number,
  ): CustomSoundRecord => ({
    id,
    name: `${id}.mp3`,
    type: "audio/mpeg",
    size: 1,
    duration: 0.5,
    updatedAt: 1,
    bytes: new Uint8Array([byte]).buffer,
  });

  it("keeps files across store instances (page reloads)", async () => {
    const factory = new IDBFactory();
    const first = createIdbCustomSoundStorage(factory);
    await first.put(record("mute", 7));
    await first.put(record("ring", 9));

    const second = createIdbCustomSoundStorage(factory);
    const rows = await second.list();
    expect(rows.map((r) => r.id).sort()).toEqual(["mute", "ring"]);
    const mute = rows.find((r) => r.id === "mute");
    expect(new Uint8Array(mute?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([7]),
    );
  });

  it("replaces, deletes and clears", async () => {
    const storage = createIdbCustomSoundStorage(new IDBFactory());
    await storage.put(record("mute", 1));
    await storage.put(record("mute", 2));
    await storage.put(record("unmute", 3));
    let rows = await storage.list();
    expect(rows).toHaveLength(2);
    expect(new Uint8Array(rows.find((r) => r.id === "mute")!.bytes)[0]).toBe(2);

    await storage.delete("mute");
    rows = await storage.list();
    expect(rows.map((r) => r.id)).toEqual(["unmute"]);

    await storage.clear();
    expect(await storage.list()).toEqual([]);
  });

  it("ignores rows for sounds that no longer exist", async () => {
    const factory = new IDBFactory();
    const storage = createIdbCustomSoundStorage(factory);
    await storage.put(record("mute", 1));
    await storage.put({ ...record("mute", 1), id: "retired" as "mute" });
    expect((await storage.list()).map((r) => r.id)).toEqual(["mute"]);
  });

  it("rejects instead of throwing when IndexedDB is missing", async () => {
    const storage = createIdbCustomSoundStorage(undefined);
    await expect(storage.list()).rejects.toThrow("IndexedDB unavailable");
  });
});
