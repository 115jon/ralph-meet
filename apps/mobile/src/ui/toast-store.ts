import { create } from "zustand";

import type { LedState } from "./Led";

export interface ToastMessage {
  readonly id: number;
  readonly label: string;
  readonly text: string;
  readonly led: LedState;
}

const useToastStore = create<{ toast: ToastMessage | null }>()(() => ({
  toast: null,
}));

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

const VISIBLE_MS = 2800;

/** Shows one toast, replacing any on screen; it leaves by itself. */
export function showToast(toast: Omit<ToastMessage, "id">): void {
  if (timer) clearTimeout(timer);
  useToastStore.setState({ toast: { ...toast, id: nextId++ } });
  timer = setTimeout(() => {
    timer = null;
    useToastStore.setState({ toast: null });
  }, VISIBLE_MS);
}

export function useToast(): ToastMessage | null {
  return useToastStore((s) => s.toast);
}
