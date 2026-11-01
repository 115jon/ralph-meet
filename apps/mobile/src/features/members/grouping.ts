import type { Role, ServerMember } from "./schema";

// The web member list's branches (src/components/chat/MemberList.tsx): the
// people online, under their highest non-default role (else "Online"), the
// branches in role order; then everyone offline in one branch. Inside a
// branch: highest role first, then username.

export interface MemberGroup {
  readonly key: string;
  readonly name: string;
  readonly online: boolean;
  readonly members: readonly ServerMember[];
}

export function highestRole(
  roles: readonly Role[] | undefined,
): Role | undefined {
  let best: Role | undefined;
  for (const role of roles ?? []) {
    if (!best || role.position > best.position) best = role;
  }
  return best;
}

function compareByRole(a: ServerMember, b: ServerMember): number {
  const ra = highestRole(a.roles)?.position ?? -1;
  const rb = highestRole(b.roles)?.position ?? -1;
  if (ra !== rb) return rb - ra;
  return a.user.username.localeCompare(b.user.username);
}

export function groupMembers(
  members: readonly ServerMember[],
  isOnline: (userId: string) => boolean,
): MemberGroup[] {
  const groups: { key: string; name: string; members: ServerMember[] }[] = [];
  const online = members.filter((m) => isOnline(m.user.id));
  for (const member of online.sort(compareByRole)) {
    const role = highestRole(member.roles);
    const name = role && !role.is_default ? role.name : "Online";
    let group = groups.find((g) => g.name === name);
    if (!group) {
      group = { key: `role:${name}`, name, members: [] };
      groups.push(group);
    }
    group.members.push(member);
  }
  const result: MemberGroup[] = groups.map((g) => ({ ...g, online: true }));
  const offline = members
    .filter((m) => !isOnline(m.user.id))
    .sort(compareByRole);
  if (offline.length > 0) {
    result.push({
      key: "offline",
      name: "Offline",
      online: false,
      members: offline,
    });
  }
  return result;
}

/** One line of the virtualised list: a branch label or a person. */
export type MemberListItem =
  | {
      readonly type: "header";
      readonly key: string;
      readonly name: string;
      readonly count: number;
    }
  | {
      readonly type: "member";
      readonly key: string;
      readonly member: ServerMember;
      readonly online: boolean;
    };

export function flattenGroups(
  groups: readonly MemberGroup[],
): MemberListItem[] {
  const items: MemberListItem[] = [];
  for (const group of groups) {
    items.push({
      type: "header",
      key: group.key,
      name: group.name,
      count: group.members.length,
    });
    for (const member of group.members) {
      items.push({
        type: "member",
        key: `${group.key}:${member.user.id}`,
        member,
        online: group.online,
      });
    }
  }
  return items;
}

// src/lib/permissions.ts
const ADMINISTRATOR = 1 << 0;
export const KICK_MEMBERS = 1 << 5;
export const BAN_MEMBERS = 1 << 6;

/** Every permission bit `userId`'s roles grant in this member list. */
export function permissionsOf(
  members: readonly ServerMember[],
  userId: string | undefined,
): number {
  const me = members.find((m) => m.user.id === userId);
  return (me?.roles ?? []).reduce((all, r) => all | (r.permissions ?? 0), 0);
}

export function hasPermission(total: number, permission: number): boolean {
  if ((total & ADMINISTRATOR) === ADMINISTRATOR) return true;
  return (total & permission) === permission;
}
