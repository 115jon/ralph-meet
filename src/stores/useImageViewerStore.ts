import type { Attachment } from '@/lib/types';
import { create } from 'zustand';

interface ViewerContext {
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

interface ImageViewerState {
  isOpen: boolean;
  initialIndex: number;
  images: Attachment[];
  context?: ViewerContext;
  actions: {
    open: (images: Attachment[], initialIndex?: number, context?: ViewerContext) => void;
    close: () => void;
  };
}

export const useImageViewerStore = create<ImageViewerState>((set) => ({
  isOpen: false,
  initialIndex: 0,
  images: [],
  context: undefined,
  actions: {
    open: (images, initialIndex = 0, context) => set({ isOpen: true, images, initialIndex, context }),
    close: () => set({ isOpen: false, images: [], initialIndex: 0, context: undefined }),
  },
}));

export const useImageViewerActions = () => useImageViewerStore((state) => state.actions);
