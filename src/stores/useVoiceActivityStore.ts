import { create } from "zustand";

export type VoiceActivityType = "wordle";

export interface VoiceActivityPresence {
  userId: string;
  channelId: string;
  activity: VoiceActivityType;
  startedAt: number;
}

interface VoiceActivityState {
  activeByUser: Record<string, VoiceActivityPresence>;
  setUserActivity: (presence: VoiceActivityPresence) => void;
  clearUserActivity: (userId: string) => void;
  getChannelActivity: (channelId?: string | null) => VoiceActivityPresence | null;
}

export const useVoiceActivityStore = create<VoiceActivityState>()((set, get) => ({
  activeByUser: {},
  setUserActivity: (presence) => set((state) => ({
    activeByUser: {
      ...state.activeByUser,
      [presence.userId]: presence,
    },
  })),
  clearUserActivity: (userId) => set((state) => {
    const next = { ...state.activeByUser };
    delete next[userId];
    return { activeByUser: next };
  }),
  getChannelActivity: (channelId) => {
    if (!channelId) return null;
    return Object.values(get().activeByUser).find((presence) => presence.channelId === channelId) ?? null;
  },
}));
