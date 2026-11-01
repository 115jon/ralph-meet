import { create } from "zustand";

// Which message rows are on screen, from the list's viewability callback.
// Animated images read their own row's flag, so a scroll re-renders only
// the images whose visibility flipped.

const useVisibleStore = create<{ ids: ReadonlySet<string> }>()(() => ({
  ids: new Set(),
}));

export function setVisibleMessages(ids: Iterable<string>): void {
  useVisibleStore.setState({ ids: new Set(ids) });
}

export function useIsMessageVisible(id: string): boolean {
  return useVisibleStore((s) => s.ids.has(id));
}
