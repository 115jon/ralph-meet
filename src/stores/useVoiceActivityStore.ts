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
  getUserActivity: (userId?: string | null, channelId?: string | null) => VoiceActivityPresence | null;
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
  getUserActivity: (userId, channelId) => {
    if (!userId) return null;
    const presence = get().activeByUser[userId];
    if (!presence) return null;
    if (channelId && presence.channelId !== channelId) return null;
    return presence;
  },
  getChannelActivity: (channelId) => {
    if (!channelId) return null;
    return Object.values(get().activeByUser).find((presence) => presence.channelId === channelId) ?? null;
  },
}));
