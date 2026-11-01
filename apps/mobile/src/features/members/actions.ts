import { apiFetch, apiJson } from "@/lib/api";
import { showToast } from "@/ui";

import {
  MemberListSchema,
  type MemberUser,
  type ProfileUpdate,
  type Role,
  type ServerMember,
} from "./schema";
import { useMembersStore } from "./store";

const { getState, setState } = useMembersStore;

/** GET /api/servers/:id/members, with roles and fresh status. */
function fetchMembers(serverId: string) {
  return apiJson(
    `/api/servers/${encodeURIComponent(serverId)}/members`,
    MemberListSchema,
  );
}

function put(serverId: string, members: readonly ServerMember[]): void {
  setState((s) => ({
    members: { ...s.members, [serverId]: members },
    authors: { ...s.authors, [serverId]: members.map((m) => m.user) },
  }));
}

const inFlight = new Map<string, Promise<void>>();

/**
 * The members of `serverId`: fetched once per session (the gateway keeps
 * them current), or again with `force` (a reconnect may have missed events).
 */
export function loadMembers(
  serverId: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!force && getState().members[serverId]) return Promise.resolve();
  const pending = inFlight.get(serverId);
  if (pending) return pending;
  const run = fetchMembers(serverId)
    .then((list) => put(serverId, list))
    .catch(() => {
      // The page keeps what it had; mentions still work typed by hand.
    })
    .finally(() => inFlight.delete(serverId));
  inFlight.set(serverId, run);
  return run;
}

/** Servers whose list is loaded: the ones to refetch after a reconnect. */
export function loadedServerIds(): string[] {
  return Object.keys(getState().members);
}

// ── Gateway events ─────────────────────────────────────────────────────────

export function addMember(
  serverId: string,
  user: MemberUser,
  roles: readonly Role[] | undefined,
): void {
  const list = getState().members[serverId];
  if (!list) return;
  const rest = list.filter((m) => m.user.id !== user.id);
  put(serverId, [
    ...rest,
    { user, roles: roles ?? [], joined_at: new Date().toISOString() },
  ]);
}

export function removeMember(serverId: string, userId: string): void {
  const list = getState().members[serverId];
  if (!list?.some((m) => m.user.id === userId)) return;
  put(
    serverId,
    list.filter((m) => m.user.id !== userId),
  );
}

export function setMemberRoles(
  serverId: string,
  userId: string,
  roles: readonly Role[] | undefined,
): void {
  const list = getState().members[serverId];
  if (!list || !roles) return;
  put(
    serverId,
    list.map((m) => (m.user.id === userId ? { ...m, roles } : m)),
  );
}

/** A renamed or re-pictured user, in every server list they are in. */
export function patchMemberProfile(update: ProfileUpdate): void {
  const { members } = getState();
  for (const [serverId, list] of Object.entries(members)) {
    if (!list.some((m) => m.user.id === update.user_id)) continue;
    put(
      serverId,
      list.map((m) => {
        if (m.user.id !== update.user_id) return m;
        const user: MemberUser = {
          ...m.user,
          ...(update.username !== undefined && { username: update.username }),
          ...(update.display_name !== undefined && {
            display_name: update.display_name,
          }),
          ...(update.avatar_url !== undefined && {
            avatar_url: update.avatar_url,
          }),
          ...(update.display_name_style !== undefined && {
            display_name_style: update.display_name_style,
          }),
        };
        return { ...m, user };
      }),
    );
  }
}

/** Every member of every loaded server, one copy per person. */
export function knownPeople(): MemberUser[] {
  const seen = new Map<string, MemberUser>();
  for (const list of Object.values(getState().members)) {
    for (const member of list) seen.set(member.user.id, member.user);
  }
  return [...seen.values()];
}

/** Which loaded servers `userId` shares: the new-DM picker's second line. */
export function serversOf(userId: string): string[] {
  return Object.entries(getState().members)
    .filter(([, list]) => list.some((m) => m.user.id === userId))
    .map(([serverId]) => serverId);
}

// ── Moderation (the web's member menu: Kick, Ban) ──────────────────────────

async function moderate(
  path: string,
  init: RequestInit,
  done: string,
  failed: string,
): Promise<boolean> {
  try {
    const response = await apiFetch(path, init);
    if (!response.ok) throw new Error(String(response.status));
    showToast({ label: "Done", text: done, led: "talk" });
    return true;
  } catch {
    showToast({ label: "Not done", text: failed, led: "danger" });
    return false;
  }
}

/** DELETE /api/servers/:id/members/:userId (KICK_MEMBERS). */
export async function kickMember(
  serverId: string,
  userId: string,
  name: string,
): Promise<void> {
  const ok = await moderate(
    `/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
    `${name} was kicked`,
    `${name} wasn't kicked. Try again.`,
  );
  if (ok) removeMember(serverId, userId);
}

/** POST /api/servers/:id/bans {user_id} (BAN_MEMBERS). */
export async function banMember(
  serverId: string,
  userId: string,
  name: string,
): Promise<void> {
  const ok = await moderate(
    `/api/servers/${encodeURIComponent(serverId)}/bans`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    },
    `${name} was banned`,
    `${name} wasn't banned. Try again.`,
  );
  if (ok) removeMember(serverId, userId);
}
