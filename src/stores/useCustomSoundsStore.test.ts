import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIdbCustomSoundStorage,
  type CustomSoundFile,
  type CustomSoundStorage,
} from "@/lib/custom-sounds";
import { createCustomSoundsStore } from "./useCustomSoundsStore";

vi.mock("@/lib/sounds", () => ({
  customSoundStorage: vi.fn(),
  soundEngine: vi.fn(),
}));

/** The first byte of a fake file is its length in tenths of a second. */
function file(name: string, tenths: number): CustomSoundFile {
  return {
    name,
    type: "audio/wav",
    size: 100,
    arrayBuffer: async () => new Uint8Array([tenths]).buffer,
  };
}

interface FakeEngine {
  decode: ReturnType<typeof vi.fn>;
  setCustomSound: ReturnType<typeof vi.fn>;
  clearCustomSounds: ReturnType<typeof vi.fn>;
}

let storage: CustomSoundStorage;
let engine: FakeEngine;

function makeStore() {
  return createCustomSoundsStore({
    storage: () => storage,
    engine: () => engine as never,
  });
}

beforeEach(() => {
  storage = createIdbCustomSoundStorage(new IDBFactory());
  engine = {
    decode: vi.fn(async (bytes: ArrayBuffer) => {
      const tenths = new Uint8Array(bytes)[0];
      if (!tenths) throw new DOMException("bad", "EncodingError");
      return { duration: tenths / 10 };
    }),
    setCustomSound: vi.fn(async () => {}),
    clearCustomSounds: vi.fn(),
  };
});

describe("custom sounds store", () => {
  it("stores an imported file, hands it to the engine and lists it", async () => {
    const store = makeStore();
    const result = await store
      .getState()
      .importFile("mute", file("pop.wav", 4));
    expect(result).toEqual({ ok: true });
    expect(engine.setCustomSound).toHaveBeenCalledWith(
      "mute",
      expect.any(ArrayBuffer),
    );
    expect(store.getState().sounds.mute).toMatchObject({
      name: "pop.wav",
      duration: 0.4,
    });
    expect(store.getState().sounds.mute).not.toHaveProperty("bytes");

    const reloaded = makeStore();
    await reloaded.getState().load();
    expect(reloaded.getState().loaded).toBe(true);
    expect(Object.keys(reloaded.getState().sounds)).toEqual(["mute"]);
  });

  it("leaves storage and engine untouched when a file is rejected", async () => {
    const store = makeStore();
    const result = await store
      .getState()
      .importFile("mute", file("bad.wav", 0));
    expect(result).toMatchObject({ error: "decode", name: "bad.wav" });
    expect(engine.setCustomSound).not.toHaveBeenCalled();
    expect(await storage.list()).toEqual([]);
  });

  it("bulk-imports by file name and reports what it skipped", async () => {
    const store = makeStore();
    const result = await store
      .getState()
      .importFiles([
        file("voice-join.wav", 3),
        file("ring.wav", 120),
        file("mystery.wav", 3),
        file("message.wav", 90),
      ]);
    expect(result.imported).toEqual(["voiceJoin", "ring"]);
    expect(result.failed).toEqual([
      expect.objectContaining({ name: "mystery.wav", error: "unmatched" }),
      expect.objectContaining({ name: "message.wav", error: "duration" }),
    ]);
    expect(Object.keys(store.getState().sounds).sort()).toEqual([
      "ring",
      "voiceJoin",
    ]);
  });

  it("resets one sound or all of them", async () => {
    const store = makeStore();
    await store.getState().importFile("mute", file("a.wav", 2));
    await store.getState().importFile("unmute", file("b.wav", 2));

    await store.getState().reset("mute");
    expect(engine.setCustomSound).toHaveBeenLastCalledWith("mute", null);
    expect(Object.keys(store.getState().sounds)).toEqual(["unmute"]);
    expect((await storage.list()).map((r) => r.id)).toEqual(["unmute"]);

    await store.getState().resetAll();
    expect(engine.clearCustomSounds).toHaveBeenCalled();
    expect(store.getState().sounds).toEqual({});
    expect(await storage.list()).toEqual([]);
  });

  it("shows an empty list when storage can't be opened", async () => {
    storage = createIdbCustomSoundStorage(undefined);
    const store = makeStore();
    await store.getState().load();
    expect(store.getState()).toMatchObject({ loaded: true, sounds: {} });
  });
});
