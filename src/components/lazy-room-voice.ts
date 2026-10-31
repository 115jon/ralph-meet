import { lazy } from "react";

// The joined room (voice stack, grid, chat panel) is a chunk of its own: the
// name prompt is all a guest needs to see, so the call code is fetched once
// they show intent to join (typing a name, or a name restored from this tab)
// and rendered when they do.
const loadRoomVoiceView = () => import("@/components/RoomVoiceView");

export const LazyRoomVoiceView = lazy(loadRoomVoiceView);

/** Start fetching the room chunk; safe to call any number of times. */
export function preloadRoomVoiceView(): void {
  void loadRoomVoiceView();
}
