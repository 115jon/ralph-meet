import { create } from "zustand";

export interface CallSegmentState {
  channel: string;
  status: string;
  muted: boolean;
}

interface CallSegmentStore {
  call: CallSegmentState | null;
  setCall: (call: CallSegmentState | null) => void;
  toggleMute: () => void;
}

// Stub until the voice PR: nothing starts a call, only the You screen's dev
// toggle does.
const useCallSegmentStore = create<CallSegmentStore>((set) => ({
  call: null,
  setCall: (call) => set({ call }),
  toggleMute: () =>
    set((state) =>
      state.call
        ? { call: { ...state.call, muted: !state.call.muted } }
        : state,
    ),
}));

/** The active call to show in the app bar, or null. */
export function useCallSegment(): CallSegmentState | null {
  return useCallSegmentStore((state) => state.call);
}

export function useCallSegmentActions() {
  const setCall = useCallSegmentStore((state) => state.setCall);
  const toggleMute = useCallSegmentStore((state) => state.toggleMute);
  return { setCall, toggleMute };
}
