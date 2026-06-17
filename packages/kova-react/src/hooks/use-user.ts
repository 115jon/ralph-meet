/**
 * useUser — the currently signed-in user record.
 *
 * Provides the user object and an `updateUser` imperative method that
 * patches the user's profile and automatically refreshes the session.
 *
 * @example
 * ```tsx
 * const { user, isLoaded, isSignedIn, updateUser } = useUser();
 *
 * async function handleNameChange(newName: string) {
 *   await updateUser({ name: newName });
 * }
 * ```
 */

import { useCallback } from "react";
import { useKovaAuth } from "../context";
import type { KovaUser, UseUserReturn } from "../types";

export function useUser(): UseUserReturn {
  const { client, sessionResult } = useKovaAuth();
  // Shared session subscription — avoids a duplicate get-session request.
  const result = sessionResult;

  const isLoaded = !result.isPending;
  const rawUser = result.data?.user ?? null;

  // Coerce Better Auth's user shape to our typed KovaUser.
  // BA's inferred user type doesn't include plugin-added fields, so we cast
  // through a plain Record to avoid DTS type-overlap errors.
  const user: KovaUser | null = rawUser
    ? (() => {
      const u = rawUser as unknown as Record<string, unknown>;
      const toDate = (v: unknown) =>
        v instanceof Date ? v : new Date((v as number | string | undefined) ?? Date.now());
      return {
        id: rawUser.id,
        name: rawUser.name,
        fullName: rawUser.name ?? null,
        email: rawUser.email,
        emailVerified: !!(u["emailVerified"] as boolean | undefined),
        image: (u["image"] as string | null | undefined) ?? null,
        imageUrl: (u["image"] as string | null | undefined) ?? undefined,
        role: (u["role"] as string | null | undefined) ?? null,
        banned: !!(u["banned"] as boolean | undefined),
        createdAt: toDate(u["createdAt"]),
        updatedAt: toDate(u["updatedAt"]),
        username: (u["username"] as string | null | undefined) ?? null,
        twoFactorEnabled: !!(u["twoFactorEnabled"] as boolean | undefined),
        primaryEmailAddress: rawUser.email ? { emailAddress: rawUser.email } : null,
        unsafeMetadata: (u["unsafeMetadata"] as Record<string, unknown> | undefined) ?? {},
        reload: async () => {
          await result.refetch();
        },
      };
    })()
    : null;

  const updateUser = useCallback(
    async (data: { name?: string; image?: string }) => {
      await client.updateUser(data);
      result.refetch();
    },
    [client, result]
  );

  return {
    user,
    isLoaded,
    isSignedIn: !!user,
    updateUser,
  };
}
