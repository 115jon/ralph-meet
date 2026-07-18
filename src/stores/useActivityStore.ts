import { create } from "zustand";

export const ACTIVITY_TYPES = ["wordle", "warp-rush"] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export function isActivityType(value: unknown): value is ActivityType {
  return (
    typeof value === "string" && ACTIVITY_TYPES.includes(value as ActivityType)
  );
}

export interface ActivityPresence {
  userId: string;
  channelId: string;
  activity: ActivityType;
  startedAt: number;
}

interface ActivityState {
  activeByUser: Record<string, ActivityPresence>;
  setUserActivity: (presence: ActivityPresence) => void;
  clearUserActivity: (userId: string) => void;
  getUserActivity: (
    userId?: string | null,
    channelId?: string | null,
  ) => ActivityPresence | null;
  getChannelActivity: (channelId?: string | null) => ActivityPresence | null;
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
  activeByUser: {},
  setUserActivity: (presence) =>
    set((state) => ({
      activeByUser: {
        ...state.activeByUser,
        [presence.userId]: presence,
      },
    })),
  clearUserActivity: (userId) =>
    set((state) => {
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
    return (
      Object.values(get().activeByUser).find(
        (presence) => presence.channelId === channelId,
      ) ?? null
    );
  },
}));
