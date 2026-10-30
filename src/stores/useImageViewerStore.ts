import type { Attachment } from "@/lib/types";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { create } from "zustand";

export interface ViewerContext {
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: AvatarDisplay | string | null;
  created_at?: string;
  onJumpToMessage?: (messageId: string) => void;
  onIndexChange?: (index: number) => void;
}

interface ImageViewerState {
  isOpen: boolean;
  initialIndex: number;
  images: Attachment[];
  context?: ViewerContext;
  actions: {
    open: (
      images: Attachment[],
      initialIndex?: number,
      context?: ViewerContext,
    ) => void;
    updateImage: (id: string, image: Attachment) => void;
    close: () => void;
  };
}

/**
 * `close()` flips `isOpen` at once but keeps the images, context and index
 * for this long, so the viewer fades out showing what it was showing instead
 * of vanishing (the exit runs 150ms). A reopen inside the window cancels the
 * pending clear, so the new images are never wiped.
 */
export const IMAGE_VIEWER_EXIT_MS = 200;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPendingClear() {
  if (clearTimer === null) return;
  clearTimeout(clearTimer);
  clearTimer = null;
}

export const useImageViewerStore = create<ImageViewerState>((set, get) => ({
  isOpen: false,
  initialIndex: 0,
  images: [],
  context: undefined,
  actions: {
    open: (images, initialIndex = 0, context) => {
      cancelPendingClear();
      set({ isOpen: true, images, initialIndex, context });
    },
    updateImage: (id, image) =>
      set((state) => ({
        images: state.images.map((current) =>
          current.id === id ? image : current,
        ),
      })),
    close: () => {
      cancelPendingClear();
      set({ isOpen: false });
      clearTimer = setTimeout(() => {
        clearTimer = null;
        // A reopen cancels this timer; the check also covers a direct setState.
        if (get().isOpen) return;
        set({ images: [], initialIndex: 0, context: undefined });
      }, IMAGE_VIEWER_EXIT_MS);
    },
  },
}));

export const useImageViewerActions = () =>
  useImageViewerStore((state) => state.actions);
