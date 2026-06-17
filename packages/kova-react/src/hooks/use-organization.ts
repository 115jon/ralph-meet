/**
 * useOrganization — active organization and current user's membership.
 *
 * Reactive: re-renders automatically when the active org changes (e.g. after
 * calling `client.organization.setActive()`).
 *
 * @example
 * ```tsx
 * const { organization, membership, isLoaded } = useOrganization();
 * if (!isLoaded) return null;
 * if (!organization) return <p>No active org</p>;
 * return <h1>{organization.name}</h1>;
 * ```
 */

import { useKovaAuth } from "../context";
import type {
  KovaMembership,
  KovaOrganization,
  UseOrganizationReturn,
} from "../types";

export function useOrganization(): UseOrganizationReturn {
  const { client } = useKovaAuth();

  // useActiveOrganization is provided by organizationClient plugin
  const orgResult = (client as unknown as {
    useActiveOrganization: () => {
      data: null | {
        id: string;
        name: string;
        slug: string;
        logo?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt?: number | string;
        membership?: {
          id: string;
          userId: string;
          organizationId: string;
          role: string;
          createdAt?: number | string;
        };
      };
      isPending: boolean;
    };
  }).useActiveOrganization?.();

  if (!orgResult) {
    // Plugin not enabled
    return { organization: null, membership: null, isLoaded: true };
  }

  const isLoaded = !orgResult.isPending;
  const raw = orgResult.data;

  const organization: KovaOrganization | null = raw
    ? {
      id: raw.id,
      name: raw.name,
      slug: raw.slug,
      logo: raw.logo ?? null,
      metadata: raw.metadata ?? null,
      createdAt: new Date(raw.createdAt ?? Date.now()),
    }
    : null;

  const membership: KovaMembership | null = raw?.membership
    ? {
      id: raw.membership.id,
      userId: raw.membership.userId,
      organizationId: raw.membership.organizationId,
      role: raw.membership.role,
      createdAt: new Date(raw.membership.createdAt ?? Date.now()),
    }
    : null;

  return { organization, membership, isLoaded };
}
