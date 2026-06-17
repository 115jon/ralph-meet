/**
 * useLinkedAccounts — list and manage the provider accounts linked to
 * the currently authenticated user.
 *
 * Calls `client.listAccounts()` (Better Auth built-in) to enumerate every
 * row from the `account` table that belongs to the current user.
 *
 * @example
 * ```tsx
 * const { accounts, isLoaded, linkAccount } = useLinkedAccounts();
 *
 * // Initiate linking a new provider:
 * await linkAccount({ provider: "github", callbackURL: "/settings" });
 *
 * // Display a "Connect Google" button when google is not yet linked:
 * const hasGoogle = accounts.some(a => a.providerId === "google");
 * ```
 */

import { useCallback, useEffect, useState } from "react";
import { useKovaAuth } from "../context";
import type { LinkedAccount, UseLinkedAccountsReturn } from "../types";

// ── Shape returned by Better Auth's listAccounts() ────────────────────────────

type RawAccount = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt?: string | number | Date | null;
  accessToken?: string | null;
  scopes?: string[] | null;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLinkedAccounts(): UseLinkedAccountsReturn {
  const { client } = useKovaAuth();

  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchAccounts = useCallback(async () => {
    // Cast through unknown: Better Auth's `listAccounts()` exists on the
    // base client but is not part of the auto-generated plugin DTS.
    const c = client as unknown as {
      listAccounts?: () => Promise<{
        data?: RawAccount[] | null;
        error?: { message?: string } | null;
      }>;
    };

    if (typeof c.listAccounts !== "function") {
      // listAccounts is only available when the user is signed in on a session
      // that Better Auth exposes it on.  Gracefully no-op if missing.
      setIsLoaded(true);
      return;
    }

    try {
      const res = await c.listAccounts();
      if (res.error?.message) {
        setError(res.error.message);
      } else {
        const raw = res.data ?? [];
        setAccounts(
          raw.map(
            (a): LinkedAccount => ({
              id: a.id,
              providerId: a.providerId,
              accountId: a.accountId,
              createdAt: normaliseDate(a.createdAt),
              accessToken: a.accessToken ?? null,
              scopes: a.scopes ?? undefined,
            })
          )
        );
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setIsLoaded(true);
    }
  }, [client]);

  // Fetch on mount (only fires when a session is active)
  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  // ── Link a new provider ───────────────────────────────────────────────────

  const linkAccount = useCallback(
    async ({
      provider,
      callbackURL = window.location.pathname,
    }: {
      provider: string;
      callbackURL?: string;
    }) => {
      setIsUpdating(true);
      setError(null);
      try {
        // `linkSocial` initiates the OAuth redirect.
        // It's available on the base auth client (no extra plugin needed).
        const c = client as unknown as {
          linkSocial?: (opts: {
            provider: string;
            callbackURL: string;
          }) => Promise<{ error?: { message?: string } | null }>;
        };

        if (typeof c.linkSocial !== "function") {
          setError("linkSocial is not available on this client build.");
          return;
        }

        const res = await c.linkSocial({ provider, callbackURL });
        if (res?.error?.message) {
          setError(res.error.message);
        }
        // On success the browser is redirected — the following line is
        // typically never reached, but we clean up anyway.
        setIsUpdating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link account");
        setIsUpdating(false);
      }
    },
    [client]
  );

  return {
    accounts,
    isLoaded,
    isUpdating,
    error,
    linkAccount,
    refetch: fetchAccounts,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function normaliseDate(v: string | number | Date | null | undefined): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  return v as string;
}
