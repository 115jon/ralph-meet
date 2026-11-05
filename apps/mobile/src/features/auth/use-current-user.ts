import { useEffect } from "react";

import { getMe } from "@/lib/api";

import { addNetworkChangeListener } from "../../../modules/ralph-network/src";
import { loadUntilLoaded } from "./load-until-loaded";
import { useSession } from "./session";

/**
 * Loads the signed-in user's profile once per token, asking again when the
 * network comes back until it loads (an app launched offline). A 401 signs
 * out in apiFetch.
 */
export function useCurrentUser() {
  const token = useSession((s) => s.token);
  const setUser = useSession((s) => s.setUser);

  useEffect(() => {
    if (!token) return;
    return loadUntilLoaded(getMe, setUser, (listener) =>
      addNetworkChangeListener((connected) => {
        if (connected) listener();
      }),
    );
  }, [token, setUser]);
}
