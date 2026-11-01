import { useEffect } from "react";

import { getMe } from "@/lib/api";

import { useSession } from "./session";

/** Loads the signed-in user's profile once per token. A 401 signs out in apiFetch. */
export function useCurrentUser() {
  const token = useSession((s) => s.token);
  const setUser = useSession((s) => s.setUser);

  useEffect(() => {
    if (!token) return;
    let live = true;
    getMe()
      .then((me) => {
        if (live) setUser(me);
      })
      .catch(() => {
        // Offline or a server error: the You tab falls back to a placeholder.
      });
    return () => {
      live = false;
    };
  }, [token, setUser]);
}
