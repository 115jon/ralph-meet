import { lazy } from "react";

import { afterLoadIdle } from "@/lib/idle";

// Panels and dialogs the chat shell only draws after a click. Each is its own
// chunk, so the shell does not carry them (the GIF picker, message search and
// channel settings are about 100 KB raw between them). `warmLazyPanels` pulls
// them in at idle after load, so the first click does not wait on the network.
const loadChannelSettingsModal = () => import("./ChannelSettingsModal");
const loadGifPickerModal = () => import("./GifPickerModal");
const loadSearchPanel = () => import("./SearchPanel");

export const LazyChannelSettingsModal = lazy(loadChannelSettingsModal);
export const LazyGifPickerModal = lazy(loadGifPickerModal);
export const LazySearchPanel = lazy(loadSearchPanel);

export function warmLazyPanels(): () => void {
  return afterLoadIdle(() => {
    for (const load of [
      loadGifPickerModal,
      loadSearchPanel,
      loadChannelSettingsModal,
    ]) {
      void load().catch(() => {});
    }
  }, 5000);
}
