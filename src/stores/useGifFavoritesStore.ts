import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import {
  GIF_FAVORITES_STORAGE_KEY,
  getGifItemIdentityKey,
  parseStoredGifFavorites,
  toggleGifFavorite,
  type GifPickerItem,
} from "@/lib/gif-picker";
import { create } from "zustand";

export const GIF_FAVORITE_ADDED_EVENT = "gif-favorite-added";

type GifFavoritesResponse = {
  favorites: GifPickerItem[];
};

interface GifFavoritesState {
  favorites: GifPickerItem[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  actions: {
    load: () => Promise<void>;
    toggle: (gif: GifPickerItem) => Promise<{ added: boolean }>;
    add: (gif: GifPickerItem) => Promise<{ added: boolean }>;
    remove: (gif: Pick<GifPickerItem, "id" | "provider">) => Promise<void>;
  };
}

let loadPromise: Promise<void> | null = null;

function readLegacyLocalFavorites(): GifPickerItem[] {
  if (typeof window === "undefined") return [];
  return parseStoredGifFavorites(window.localStorage.getItem(GIF_FAVORITES_STORAGE_KEY));
}

function clearLegacyLocalFavorites() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GIF_FAVORITES_STORAGE_KEY);
}

function notifyFavoriteAdded() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GIF_FAVORITE_ADDED_EVENT));
}

export const useGifFavoritesStore = create<GifFavoritesState>((set, get) => ({
  favorites: [],
  loaded: false,
  loading: false,
  error: null,
  actions: {
    load: async () => {
      const state = get();
      if (state.loaded) return;
      if (loadPromise) return loadPromise;

      loadPromise = (async () => {
        set({ loading: true, error: null });
        try {
          const data = await apiGet<GifFavoritesResponse>("/api/gifs?mode=favorites");
          const legacyFavorites = readLegacyLocalFavorites();
          if (legacyFavorites.length > 0) {
            const imported = await apiPost<GifFavoritesResponse, { favorites: GifPickerItem[] }>(
              "/api/gifs?mode=favorites/import",
              { favorites: legacyFavorites }
            );
            set({ favorites: imported.favorites, loaded: true, loading: false, error: null });
            clearLegacyLocalFavorites();
            return;
          }

          set({ favorites: data.favorites, loaded: true, loading: false, error: null });
        } catch (error) {
          set({ loading: false, error: error instanceof Error ? error.message : "Failed to load GIF favorites" });
        } finally {
          loadPromise = null;
        }
      })();

      return loadPromise;
    },

    add: async (gif) => {
      await get().actions.load();
      const key = getGifItemIdentityKey(gif);
      const alreadyFavorite = get().favorites.some((item) => getGifItemIdentityKey(item) === key);
      if (alreadyFavorite) return { added: false };

      const previous = get().favorites;
      set({ favorites: toggleGifFavorite(previous, gif), error: null });
      try {
        const data = await apiPost<GifFavoritesResponse, { favorite: GifPickerItem }>("/api/gifs?mode=favorite", { favorite: gif });
        set({ favorites: data.favorites, loaded: true, error: null });
        notifyFavoriteAdded();
        return { added: true };
      } catch (error) {
        set({ favorites: previous, error: error instanceof Error ? error.message : "Failed to save GIF favorite" });
        throw error;
      }
    },

    remove: async (gif) => {
      await get().actions.load();
      const previous = get().favorites;
      set({ favorites: previous.filter((item) => getGifItemIdentityKey(item) !== getGifItemIdentityKey(gif)), error: null });
      try {
        const data = await apiDelete<GifFavoritesResponse, { provider: string; gif_id: string }>("/api/gifs?mode=favorite", {
          provider: gif.provider,
          gif_id: gif.id,
        });
        set({ favorites: data.favorites, loaded: true, error: null });
      } catch (error) {
        set({ favorites: previous, error: error instanceof Error ? error.message : "Failed to remove GIF favorite" });
        throw error;
      }
    },

    toggle: async (gif) => {
      await get().actions.load();
      const key = getGifItemIdentityKey(gif);
      const alreadyFavorite = get().favorites.some((item) => getGifItemIdentityKey(item) === key);
      if (alreadyFavorite) {
        await get().actions.remove(gif);
        return { added: false };
      }

      return get().actions.add(gif);
    },
  },
}));

export const useGifFavoriteActions = () => useGifFavoritesStore((state) => state.actions);
