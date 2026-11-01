// ============================================================================
// Custom sounds store (experimental)
//
// What the settings page shows about imported sound files, and the actions
// that change them. Each action keeps three things in step: the file in
// IndexedDB (`custom-sounds.ts`), the decoded buffer in the sound engine, and
// this list. Files are per device; nothing here syncs to the server.
// ============================================================================

import { create } from "zustand";
import {
  soundIdForFilename,
  toMeta,
  validateCustomSound,
  type CustomSoundError,
  type CustomSoundFile,
  type CustomSoundMeta,
  type CustomSoundStorage,
} from "@/lib/custom-sounds";
import type { SoundId } from "@/lib/sound-catalog";
import {
  customSoundStorage,
  soundEngine,
  type SoundEngine,
} from "@/lib/sounds";

export interface ImportFailure {
  name: string;
  error: CustomSoundError;
  message: string;
}

export interface BulkImportResult {
  imported: SoundId[];
  failed: ImportFailure[];
}

export interface CustomSoundsDeps {
  storage: () => CustomSoundStorage;
  engine: () => Pick<
    SoundEngine,
    "decode" | "setCustomSound" | "clearCustomSounds"
  >;
}

interface CustomSoundsState {
  sounds: Partial<Record<SoundId, CustomSoundMeta>>;
  loaded: boolean;
  /** Read the stored list (metadata only). */
  load: () => Promise<void>;
  /** Validate and store one file for `id`. */
  importFile: (
    id: SoundId,
    file: CustomSoundFile,
  ) => Promise<{ ok: true } | ImportFailure>;
  /** Import several files, each matched to a sound by its file name. */
  importFiles: (files: CustomSoundFile[]) => Promise<BulkImportResult>;
  reset: (id: SoundId) => Promise<void>;
  resetAll: () => Promise<void>;
}

export function createCustomSoundsStore(deps: CustomSoundsDeps) {
  return create<CustomSoundsState>()((set, get) => {
    const importFile: CustomSoundsState["importFile"] = async (id, file) => {
      const engine = deps.engine();
      const result = await validateCustomSound(id, file, async (bytes) => {
        const buffer = await engine.decode(bytes);
        return buffer.duration;
      });
      if (!result.ok) {
        return {
          name: file.name,
          error: result.error,
          message: result.message,
        };
      }
      await deps.storage().put(result.record);
      await engine.setCustomSound(id, result.record.bytes);
      set((s) => ({ sounds: { ...s.sounds, [id]: toMeta(result.record) } }));
      return { ok: true };
    };

    return {
      sounds: {},
      loaded: false,

      async load() {
        try {
          const records = await deps.storage().list();
          set({
            loaded: true,
            sounds: Object.fromEntries(records.map((r) => [r.id, toMeta(r)])),
          });
        } catch {
          set({ loaded: true, sounds: {} });
        }
      },

      importFile,

      async importFiles(files) {
        const imported: SoundId[] = [];
        const failed: ImportFailure[] = [];
        for (const file of files) {
          const id = soundIdForFilename(file.name);
          if (!id) {
            failed.push({
              name: file.name,
              error: "unmatched",
              message: `${file.name} doesn't match a sound name.`,
            });
            continue;
          }
          const result = await importFile(id, file);
          if ("ok" in result) imported.push(id);
          else failed.push(result);
        }
        return { imported, failed };
      },

      async reset(id) {
        await deps.storage().delete(id);
        await deps.engine().setCustomSound(id, null);
        const sounds = { ...get().sounds };
        delete sounds[id];
        set({ sounds });
      },

      async resetAll() {
        await deps.storage().clear();
        deps.engine().clearCustomSounds();
        set({ sounds: {} });
      },
    };
  });
}

export const useCustomSoundsStore = createCustomSoundsStore({
  storage: customSoundStorage,
  engine: soundEngine,
});
