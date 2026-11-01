import { create } from "zustand";

// Which message rows are on screen, from the list's viewability callback.
// Animated media read their own row's flag, so a scroll re-renders only
// the tiles whose visibility flipped. While another screen covers the chat
// nothing counts as visible, and the rows come back as they were.

const useVisibleStore = create<{
  ids: ReadonlySet<string>;
  covered: boolean;
}>()(() => ({ ids: new Set(), covered: false }));

export function setVisibleMessages(ids: Iterable<string>): void {
  useVisibleStore.setState({ ids: new Set(ids) });
}

export function setChatCovered(covered: boolean): void {
  useVisibleStore.setState({ covered });
}

export function useIsMessageVisible(id: string): boolean {
  return useVisibleStore((s) => !s.covered && s.ids.has(id));
}
