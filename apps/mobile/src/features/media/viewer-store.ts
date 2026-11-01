import { create } from "zustand";

export interface ViewerImage {
  readonly url: string;
  readonly label: string;
  readonly animated: boolean;
}

/** The pictures of one message, and which of them is on screen first. */
export interface ViewerGallery {
  readonly images: readonly ViewerImage[];
  readonly index: number;
}

const useViewerStore = create<{ gallery: ViewerGallery | null }>()(() => ({
  gallery: null,
}));

/**
 * Opens the full-screen viewer over everything on `image`, paging through
 * `siblings` (the message's other pictures) when it is one of them.
 */
export function openImage(
  image: ViewerImage,
  siblings: readonly ViewerImage[] = [],
): void {
  const index = siblings.findIndex((s) => s.url === image.url);
  useViewerStore.setState({
    gallery:
      index >= 0 ? { images: siblings, index } : { images: [image], index: 0 },
  });
}

export function closeImage(): void {
  useViewerStore.setState({ gallery: null });
}

export function useViewerGallery(): ViewerGallery | null {
  return useViewerStore((s) => s.gallery);
}
