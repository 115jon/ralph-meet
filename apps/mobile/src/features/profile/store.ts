import { create } from "zustand";

import { useSession } from "@/features/auth/session";
import { apiJson } from "@/lib/api";

import { ProfileSchema, type Profile } from "./schema";

/** What a tap already knows about the person, shown while the profile loads. */
export interface ProfileSeed {
  readonly username?: string;
  readonly display_name?: string | null;
  readonly avatar_url?: string | null;
}

export interface ProfileTarget {
  readonly userId: string;
  readonly seed?: ProfileSeed;
}

interface ProfileState {
  /** Someone else's profile sheet, open over everything. */
  readonly target: ProfileTarget | null;
  /** Your own: the panel's status sheet. */
  readonly selfOpen: boolean;
  /** userId → their profile, kept for the session (reopening is instant). */
  readonly profiles: Readonly<Record<string, Profile>>;
  readonly failed: Readonly<Record<string, true>>;
}

const useProfileStore = create<ProfileState>()(() => ({
  target: null,
  selfOpen: false,
  profiles: {},
  failed: {},
}));

const { getState, setState } = useProfileStore;

/** GET /api/users/:id/profile, into the cache. */
export async function loadProfile(userId: string): Promise<void> {
  try {
    const profile = await apiJson(
      `/api/users/${encodeURIComponent(userId)}/profile`,
      ProfileSchema,
    );
    setState((s) => {
      const { [userId]: _, ...failed } = s.failed;
      return { profiles: { ...s.profiles, [userId]: profile }, failed };
    });
  } catch {
    setState((s) => ({ failed: { ...s.failed, [userId]: true } }));
  }
}

/**
 * Opens `userId`'s profile from a name, avatar, mention or row. Your own
 * opens the status sheet instead, as on the web.
 */
export function openProfile(userId: string, seed?: ProfileSeed): void {
  if (userId === useSession.getState().user?.id) {
    setState({ selfOpen: true, target: null });
    return;
  }
  setState({ target: { userId, seed } });
  void loadProfile(userId);
}

export function openSelfProfile(): void {
  setState({ selfOpen: true });
}

export function closeProfile(): void {
  setState({ target: null, selfOpen: false });
}

/** USER_PROFILE_UPDATE: an open profile reloads; a cached one is dropped. */
export function noteProfileChanged(userId: string): void {
  if (getState().target?.userId === userId) {
    void loadProfile(userId);
    return;
  }
  if (!getState().profiles[userId]) return;
  setState((s) => {
    const { [userId]: _, ...profiles } = s.profiles;
    return { profiles };
  });
}

export function resetProfiles(): void {
  setState({ target: null, selfOpen: false, profiles: {}, failed: {} });
}

export function useProfileTarget(): ProfileTarget | null {
  return useProfileStore((s) => s.target);
}

export function useSelfProfileOpen(): boolean {
  return useProfileStore((s) => s.selfOpen);
}

export function useProfile(userId: string): Profile | null {
  return useProfileStore((s) => s.profiles[userId] ?? null);
}

export function useProfileFailed(userId: string): boolean {
  return useProfileStore((s) => s.failed[userId] === true);
}
