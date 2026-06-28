import { DEFAULT_MEDIA_CONTENT_FILTER, type MediaContentFilter } from "@/lib/media-content-filter";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MediaSafetySettings {
  contentFilter: MediaContentFilter;
}

interface MediaSafetySettingsState {
  currentUser: string | null;
  userSettings: Record<string, MediaSafetySettings>;
  _cache: Record<string, MediaSafetySettings>;
  setCurrentUser: (userId: string | null) => void;
  getSettings: (userId?: string | null) => MediaSafetySettings;
  hydrateSettings: (settings: Partial<MediaSafetySettings>, userId?: string | null) => void;
  updateSettings: (updates: Partial<MediaSafetySettings>, userId?: string) => void;
}

const defaultMediaSafetySettings: MediaSafetySettings = {
  contentFilter: DEFAULT_MEDIA_CONTENT_FILTER,
};

export const useMediaSafetySettingsStore = create<MediaSafetySettingsState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      userSettings: {},
      _cache: {},

      setCurrentUser: (userId) => set({ currentUser: userId }),

      getSettings: (userId) => {
        const uid = userId || get().currentUser;
        if (!uid) return defaultMediaSafetySettings;
        const raw = get().userSettings[uid];
        if (!raw) return defaultMediaSafetySettings;

        const cached = get()._cache[uid];
        if (
          cached &&
          cached.contentFilter === (raw.contentFilter ?? defaultMediaSafetySettings.contentFilter)
        ) {
          return cached;
        }

        const merged = { ...defaultMediaSafetySettings, ...raw };
        get()._cache[uid] = merged;
        return merged;
      },

      hydrateSettings: (settings, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;

        set((state) => {
          const current = state.userSettings[uid];
          const nextSettings = {
            ...defaultMediaSafetySettings,
            ...current,
            ...settings,
          };
          const currentResolved = current
            ? { ...defaultMediaSafetySettings, ...current }
            : defaultMediaSafetySettings;

          if (currentResolved.contentFilter === nextSettings.contentFilter) {
            return state;
          }

          const nextCache = { ...state._cache };
          delete nextCache[uid];

          return {
            _cache: nextCache,
            userSettings: {
              ...state.userSettings,
              [uid]: nextSettings,
            },
          };
        });
      },

      updateSettings: (updates, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;

        set((state) => {
          const nextCache = { ...state._cache };
          delete nextCache[uid];

          return {
            _cache: nextCache,
            userSettings: {
              ...state.userSettings,
              [uid]: {
                ...defaultMediaSafetySettings,
                ...state.userSettings[uid],
                ...updates,
              },
            },
          };
        });
      },
    }),
    {
      name: "media-safety-settings-storage",
      version: 1,
    }
  )
);
