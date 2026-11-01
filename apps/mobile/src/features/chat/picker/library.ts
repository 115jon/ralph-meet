import { create } from "zustand";

import { showToast } from "@/ui";

import {
  addGifFavorite,
  fetchCreations,
  fetchGifFavorites,
  gifErrorText,
  gifKey,
  removeGifFavorite,
  type Creation,
  type Gif,
} from "./api";

// What the picker reads from the account: its own emoji ("Your creations")
// and its starred GIFs. Fetched on the first open after launch, refreshed on
// later opens, dropped on sign-out.

type Load = "idle" | "loading" | "ready" | "error";

interface LibraryState {
  readonly creations: readonly Creation[];
  readonly creationsLoad: Load;
  readonly favorites: readonly Gif[];
  readonly favoritesLoad: Load;
}

const INITIAL: LibraryState = {
  creations: [],
  creationsLoad: "idle",
  favorites: [],
  favoritesLoad: "idle",
};

const useLibrary = create<LibraryState>()(() => INITIAL);

/** Ready creations only: a pending or failed one has no image to insert. */
export function useCreations(): readonly Creation[] {
  return useLibrary((s) => s.creations);
}

export function useGifFavorites() {
  const favorites = useLibrary((s) => s.favorites);
  const load = useLibrary((s) => s.favoritesLoad);
  return { favorites, load };
}

export function useIsFavorite(gif: Gif): boolean {
  const key = gifKey(gif);
  return useLibrary((s) => s.favorites.some((item) => gifKey(item) === key));
}

export async function loadCreations(): Promise<void> {
  if (useLibrary.getState().creationsLoad === "loading") return;
  useLibrary.setState({ creationsLoad: "loading" });
  try {
    const items = await fetchCreations();
    useLibrary.setState({
      creations: items.filter(
        (item) => item.status === "ready" && !!item.image_url,
      ),
      creationsLoad: "ready",
    });
  } catch {
    // Keep what was there; the grid simply has no creations section.
    useLibrary.setState({ creationsLoad: "error" });
  }
}

export async function loadGifFavorites(): Promise<void> {
  if (useLibrary.getState().favoritesLoad === "loading") return;
  useLibrary.setState({ favoritesLoad: "loading" });
  try {
    useLibrary.setState({
      favorites: await fetchGifFavorites(),
      favoritesLoad: "ready",
    });
  } catch {
    useLibrary.setState({ favoritesLoad: "error" });
  }
}

/**
 * Stars or unstars a GIF at once, then takes the server's list; a failure
 * puts the old list back and says so. Answers whether it is now a favorite.
 */
export async function toggleGifFavorite(gif: Gif): Promise<boolean> {
  const key = gifKey(gif);
  const before = useLibrary.getState().favorites;
  const adding = !before.some((item) => gifKey(item) === key);
  useLibrary.setState({
    favorites: adding
      ? [gif, ...before]
      : before.filter((item) => gifKey(item) !== key),
  });
  try {
    const favorites = adding
      ? await addGifFavorite(gif)
      : await removeGifFavorite(gif);
    useLibrary.setState({ favorites, favoritesLoad: "ready" });
  } catch (error) {
    useLibrary.setState({ favorites: before });
    showToast({ label: "Not saved", text: gifErrorText(error), led: "danger" });
    return !adding;
  }
  return adding;
}

/** Sign-out: both lists belong to the account. */
export function resetLibrary(): void {
  useLibrary.setState(INITIAL, true);
}
