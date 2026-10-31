import { create } from "zustand";

import type { Me } from "@/lib/api";

import { clearToken, getToken, setToken } from "./token-store";

type SessionState =
  | { status: "loading"; token: null; user?: undefined }
  | { status: "signed-out"; token: null; user?: undefined }
  | { status: "signed-in"; token: string; user?: Me };

interface SessionActions {
  /** Reads the stored token once at launch. */
  hydrate: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: Me) => void;
}

export const useSession = create<SessionState & SessionActions>((set, get) => ({
  status: "loading",
  token: null,

  hydrate: async () => {
    const token = await getToken();
    set(token ? { status: "signed-in", token } : { status: "signed-out" });
  },

  signIn: async (token) => {
    await setToken(token);
    set({ status: "signed-in", token, user: undefined });
  },

  signOut: async () => {
    set({ status: "signed-out", token: null, user: undefined });
    await clearToken();
  },

  setUser: (user) => {
    if (get().status === "signed-in") set({ user });
  },
}));
