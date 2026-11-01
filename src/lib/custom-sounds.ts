// ============================================================================
// Custom sounds (experimental)
//
// People can replace any UI sound with an audio file of their own. Files are
// validated here (type, size, decodable, length) and kept in IndexedDB on this
// device only; nothing is uploaded or bundled. The engine in `sounds.ts`
// decodes them once and plays them through the same gate and bus as the
// built-in sounds.
// ============================================================================

import {
  isLoopSound,
  SOUND_IDS,
  soundFileStem,
  type SoundId,
} from "@/lib/sound-catalog";

export const CUSTOM_SOUND_LIMITS = {
  maxBytes: 1024 * 1024,
  maxSeconds: 5,
  maxRingSeconds: 15,
} as const;

export const CUSTOM_SOUND_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
  ".m4a",
  ".aac",
  ".flac",
] as const;

/** For `<input type="file" accept>`. */
export const CUSTOM_SOUND_ACCEPT = ["audio/*", ...CUSTOM_SOUND_EXTENSIONS].join(
  ",",
);

export interface CustomSoundRecord {
  id: SoundId;
  /** Original file name, shown in settings. */
  name: string;
  type: string;
  size: number;
  /** Seconds, from the decoded audio. */
  duration: number;
  updatedAt: number;
  bytes: ArrayBuffer;
}

export type CustomSoundMeta = Omit<CustomSoundRecord, "bytes">;

/** The subset of `File` validation reads, so tests can pass plain objects. */
export interface CustomSoundFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type CustomSoundError =
  | "type"
  | "size"
  | "empty"
  | "decode"
  | "duration"
  | "unmatched";

export type ValidationResult =
  | { ok: true; record: CustomSoundRecord }
  | { ok: false; error: CustomSoundError; message: string };

/** Decodes audio; resolves with the decoded duration in seconds. */
export type DecodeDuration = (bytes: ArrayBuffer) => Promise<number>;

export function maxSecondsFor(id: SoundId): number {
  return isLoopSound(id)
    ? CUSTOM_SOUND_LIMITS.maxRingSeconds
    : CUSTOM_SOUND_LIMITS.maxSeconds;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function looksLikeAudio(file: CustomSoundFile): boolean {
  if (file.type.startsWith("audio/")) return true;
  // Some platforms leave the MIME type empty or report video/webm for Opus.
  return (CUSTOM_SOUND_EXTENSIONS as readonly string[]).includes(
    extensionOf(file.name),
  );
}

/**
 * The sound a bulk-imported file is for, from its name: `voice-join.mp3`,
 * `voiceJoin.wav` and `Voice_Join.ogg` all match `voiceJoin`.
 */
export function soundIdForFilename(name: string): SoundId | null {
  const dot = name.lastIndexOf(".");
  const stem = (dot === -1 ? name : name.slice(0, dot))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return SOUND_IDS.find((id) => id.toLowerCase() === stem) ?? null;
}

/** Every sound id with the file name a bulk import expects for it. */
export function customSoundFileNames(): Array<{ id: SoundId; file: string }> {
  return SOUND_IDS.map((id) => ({ id, file: soundFileStem(id) }));
}

const MB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

/**
 * Checks a file before it replaces sound `id`: an audio type, at most 1 MB,
 * decodable by this browser, and no longer than 5 s (15 s for rings).
 */
export async function validateCustomSound(
  id: SoundId,
  file: CustomSoundFile,
  decodeDuration: DecodeDuration,
  now: () => number = Date.now,
): Promise<ValidationResult> {
  if (!looksLikeAudio(file)) {
    return {
      ok: false,
      error: "type",
      message: `${file.name} isn't an audio file.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: "empty", message: `${file.name} is empty.` };
  }
  if (file.size > CUSTOM_SOUND_LIMITS.maxBytes) {
    return {
      ok: false,
      error: "size",
      message: `${file.name} is larger than ${MB(CUSTOM_SOUND_LIMITS.maxBytes)}.`,
    };
  }
  const bytes = await file.arrayBuffer();
  let duration: number;
  try {
    // decodeAudioData detaches the buffer it gets, so decode a copy.
    duration = await decodeDuration(bytes.slice(0));
  } catch {
    return {
      ok: false,
      error: "decode",
      message: `${file.name} couldn't be read as audio on this device.`,
    };
  }
  const limit = maxSecondsFor(id);
  if (!Number.isFinite(duration) || duration <= 0 || duration > limit) {
    return {
      ok: false,
      error: "duration",
      message: `${file.name} is longer than ${limit} seconds.`,
    };
  }
  return {
    ok: true,
    record: {
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      duration,
      updatedAt: now(),
      bytes,
    },
  };
}

// ── Storage ─────────────────────────────────────────────────────────────────

export interface CustomSoundStorage {
  list(): Promise<CustomSoundRecord[]>;
  put(record: CustomSoundRecord): Promise<void>;
  delete(id: SoundId): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "ralph-custom-sounds";
const STORE = "sounds";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB storage, one record per sound id. Local to this device. */
export function createIdbCustomSoundStorage(
  factory: IDBFactory | undefined = globalThis.indexedDB,
  dbName = DB_NAME,
): CustomSoundStorage {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!factory) return Promise.reject(new Error("IndexedDB unavailable"));
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        db = null;
        reject(req.error);
      };
    });
    return db;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const tx = (await open()).transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const [result] = await Promise.all([
      request(body(tx.objectStore(STORE))),
      done,
    ]);
    return result;
  };
  return {
    async list() {
      const rows = await run("readonly", (s) => s.getAll());
      const known = new Set<string>(SOUND_IDS);
      return (rows as CustomSoundRecord[]).filter(
        (r) => known.has(r.id) && r.bytes instanceof ArrayBuffer,
      );
    },
    async put(record) {
      await run("readwrite", (s) => s.put(record));
    },
    async delete(id) {
      await run("readwrite", (s) => s.delete(id));
    },
    async clear() {
      await run("readwrite", (s) => s.clear());
    },
  };
}

export function toMeta({ bytes: _bytes, ...meta }: CustomSoundRecord) {
  return meta satisfies CustomSoundMeta;
}
