import { create } from "zustand";

/** Phone home tabs (below md). The conversation view has no tab bar. */
export type MobileTab = "servers" | "messages" | "notifications" | "you";

export const MOBILE_TABS: readonly MobileTab[] = [
  "servers",
  "messages",
  "notifications",
  "you",
];

interface MobileTabState {
  tab: MobileTab;
  setTab: (tab: MobileTab) => void;
}

export const useMobileTabStore = create<MobileTabState>((set) => ({
  tab: "servers",
  setTab: (tab) => set({ tab }),
}));
