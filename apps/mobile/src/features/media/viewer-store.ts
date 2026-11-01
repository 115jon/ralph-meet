import { create } from "zustand";

export interface ViewerImage {
  readonly url: string;
  readonly label: string;
  readonly animated: boolean;
}

const useViewerStore = create<{ image: ViewerImage | null }>()(() => ({
  image: null,
}));

/** Opens the full-screen viewer over everything. */
export function openImage(image: ViewerImage): void {
  useViewerStore.setState({ image });
}

export function closeImage(): void {
  useViewerStore.setState({ image: null });
}

export function useViewerImage(): ViewerImage | null {
  return useViewerStore((s) => s.image);
}
