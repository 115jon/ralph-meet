import { createContext, use } from "react";

import type { ViewerImage } from "@/features/media/viewer-store";

/** The pictures of the message a tile sits in, so the viewer can page through them. */
export const MessageGallery = createContext<readonly ViewerImage[]>([]);

export function useMessageGallery(): readonly ViewerImage[] {
  return use(MessageGallery);
}
