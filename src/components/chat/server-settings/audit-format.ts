/**
 * Audit log copy (overlays audit flow 13): each entry reads as a sentence
 * ("Jon updated role Moderator"), targets by name (the ID only in a
 * tooltip), and permission changes as a diff list ("+ Manage messages").
 * Never raw IDs or bitfields in the visible text.
 *
 * The log stores new values only, so a ROLE_UPDATE diffs against the most
 * recent older entries for the same role in the loaded page. With nothing
 * older to compare, it lists what the role now allows.
 */

import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import type { ServerAuditLog } from "@/lib/types";

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  ADMINISTRATOR: "Administrator",
  MANAGE_SERVER: "Manage server",
  MANAGE_ROLES: "Manage roles",
  MANAGE_CATEGORIES: "Manage categories",
  MANAGE_CHANNELS: "Manage channels",
  KICK_MEMBERS: "Kick members",
  BAN_MEMBERS: "Ban members",
  CREATE_INVITE: "Create invites",
  VIEW_CHANNELS: "View channels",
  SEND_MESSAGES: "Send messages",
  MANAGE_MESSAGES: "Manage messages",
  ADD_REACTIONS: "Add reactions",
  ATTACH_FILES: "Attach files",
  CONNECT: "Connect",
  SPEAK: "Speak",
  VIDEO: "Video",
  MUTE_MEMBERS: "Mute members",
  DEAFEN_MEMBERS: "Deafen members",
  VIEW_AUDIT_LOG: "View audit log",
};

/** Permission names set in `bits`, in bit order. */
function permissionNames(bits: number): string[] {
  return (Object.keys(PERMISSIONS) as PermissionKey[])
    .filter((key) => (bits & PERMISSIONS[key]) === PERMISSIONS[key])
    .map((key) => PERMISSION_LABELS[key]);
}

type TargetKind = "role" | "channel" | "member" | "invite" | "server";

export type AuditLookup = {
  roles: Map<string, string>;
  members: Map<string, string>;
  channels: Map<string, { name: string; voice: boolean }>;
};

export type AuditTarget = {
  kind: TargetKind;
  /** What to show; a generic noun ("a member") when the name is unknown. */
  label: string;
  /** Whether `label` is a real name (bold) or the generic fallback. */
  named: boolean;
  id: string | null;
  /** Invite codes are codes: shown in mono. */
  code?: boolean;
};

export type AuditDetail =
  | { type: "text"; text: string }
  | { type: "perm"; sign: "+" | "−"; name: string }
  | { type: "list"; label: string; items: string[] };

export type AuditEntry = {
  /** "updated role" / "banned" / "updated the server". */
  verb: string;
  target: AuditTarget | null;
  details: AuditDetail[];
};

const GENERIC: Record<TargetKind, string> = {
  role: "a role",
  channel: "a channel",
  member: "a member",
  invite: "an invite",
  server: "the server",
};

const VERBS: Record<string, string> = {
  CREATE: "created",
  UPDATE: "updated",
  DELETE: "deleted",
  ADD: "added",
  REMOVE: "removed",
  BAN: "banned",
  UNBAN: "unbanned",
  KICK: "kicked",
  REVOKE: "revoked",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A change may be the new value, or `{ old, new }`. */
function split(value: unknown): { before?: unknown; after: unknown } {
  const record = asRecord(value);
  if ("new" in record || "old" in record) {
    return { before: record.old, after: record.new };
  }
  return { after: value };
}

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === "";

function onOff(value: unknown) {
  return value === true || value === 1 || value === "1" ? "on" : "off";
}

const channelLabel = (name: string, voice: boolean) =>
  voice ? name : `#${name}`;

function resolveTarget(
  kind: TargetKind,
  id: string | null | undefined,
  lookup: AuditLookup,
  changes: Record<string, unknown>,
): AuditTarget {
  const targetId = id ?? null;
  if (kind === "server") {
    return { kind, label: GENERIC.server, named: false, id: null };
  }
  if (kind === "invite" && targetId) {
    return { kind, label: targetId, named: true, id: null, code: true };
  }
  let name: string | undefined;
  if (targetId) {
    if (kind === "role") name = lookup.roles.get(targetId);
    if (kind === "member") name = lookup.members.get(targetId);
    if (kind === "channel") {
      const channel = lookup.channels.get(targetId);
      if (channel) name = channelLabel(channel.name, channel.voice);
    }
  }
  // Create and delete entries carry the name they had at the time.
  if (!name && typeof changes.name === "string" && changes.name) {
    name =
      kind === "channel"
        ? channelLabel(changes.name, changes.channel_type === "voice")
        : changes.name;
  }
  return name
    ? { kind, label: name, named: true, id: targetId }
    : { kind, label: GENERIC[kind], named: false, id: targetId };
}

function kindFromType(noun: string): TargetKind {
  if (noun.includes("ROLE")) return "role";
  if (noun.includes("CHANNEL") || noun.includes("CATEGORY")) return "channel";
  if (noun.includes("INVITE")) return "invite";
  if (noun.includes("MEMBER") || noun.includes("USER")) return "member";
  return "server";
}

const SERVER_FIELDS: Record<string, string> = {
  allow_public_shares: "Public message shares",
  show_source_in_shares: "Server and channel on shares",
  allow_share_indexing: "Search engine indexing",
};

function serverDetails(changes: Record<string, unknown>): AuditDetail[] {
  const details: AuditDetail[] = [];
  for (const [key, raw] of Object.entries(changes)) {
    const { after } = split(raw);
    if (key === "name")
      details.push({ type: "text", text: `Renamed to ${after}` });
    else if (key === "icon_url")
      details.push({
        type: "text",
        text: isEmpty(after) ? "Removed the icon" : "Changed the icon",
      });
    else if (key === "invites_paused")
      details.push({
        type: "text",
        text: onOff(after) === "on" ? "Paused invites" : "Resumed invites",
      });
    else if (SERVER_FIELDS[key])
      details.push({
        type: "text",
        text: `${SERVER_FIELDS[key]} ${onOff(after)}`,
      });
  }
  return details;
}

function channelDetails(changes: Record<string, unknown>): AuditDetail[] {
  const details: AuditDetail[] = [];
  for (const [key, raw] of Object.entries(changes)) {
    const { before, after } = split(raw);
    if (key === "name")
      details.push({ type: "text", text: `Renamed to ${after}` });
    else if (key === "description")
      details.push({
        type: "text",
        text: isEmpty(after) ? "Cleared the topic" : `Topic: ${after}`,
      });
    else if (key === "allow_public_shares")
      details.push({
        type: "text",
        text: isEmpty(after)
          ? "Public sharing follows the server"
          : `Public sharing ${onOff(after)}`,
      });
    else if (key === "voice_status")
      details.push({
        type: "text",
        text: isEmpty(after)
          ? "Cleared the voice status"
          : isEmpty(before)
            ? `Voice status: ${after}`
            : `Voice status: ${before} → ${after}`,
      });
  }
  return details;
}

function permissionDiff(before: number, after: number): AuditDetail[] {
  const added = permissionNames(after & ~before);
  const removed = permissionNames(before & ~after);
  return [
    ...added.map((name) => ({
      type: "perm" as const,
      sign: "+" as const,
      name,
    })),
    ...removed.map((name) => ({
      type: "perm" as const,
      sign: "−" as const,
      name,
    })),
  ];
}

/** A role's last known state before an entry, from older entries. */
export type RoleState = {
  name?: string;
  color?: string | null;
  permissions?: number;
};

function roleDetails(
  changes: Record<string, unknown>,
  previous: RoleState | undefined,
  creating: boolean,
): AuditDetail[] {
  const details: AuditDetail[] = [];
  // The client sends name and colour with every save, so they are only a
  // change when they differ from the role's previous known state.
  for (const [key, raw] of Object.entries(changes)) {
    const { before, after } = split(raw);
    const was =
      before !== undefined ? before : previous?.[key as keyof RoleState];
    const known = before !== undefined || (previous && key in previous);
    if (key === "name") {
      if (!creating && known && was !== after)
        details.push({ type: "text", text: `Renamed to ${after}` });
    } else if (key === "color") {
      const changed = creating
        ? !isEmpty(after)
        : known && (was ?? null) !== (after ?? null);
      if (changed)
        details.push({
          type: "text",
          text: isEmpty(after)
            ? "Removed the colour"
            : `Colour set to ${after}`,
        });
    } else if (key === "position") {
      if (!known || was !== after)
        details.push({ type: "text", text: "Moved in the role list" });
    } else if (key === "permissions" && typeof after === "number") {
      const from =
        typeof before === "number"
          ? before
          : creating
            ? 0
            : previous?.permissions;
      if (from === undefined) {
        const names = permissionNames(after);
        details.push({
          type: "list",
          label: "Now allows",
          items: names.length > 0 ? names : ["Nothing"],
        });
      } else {
        details.push(...permissionDiff(from, after));
      }
    }
  }
  return details;
}

/**
 * The state each ROLE_* entry follows from: what the older entries for the
 * same role in `logs` (newest first) last recorded.
 */
export function previousRoleStates(
  logs: ServerAuditLog[],
): Map<string, RoleState | undefined> {
  const result = new Map<string, RoleState | undefined>();
  const known = new Map<string, RoleState>();
  // Walk oldest to newest, folding each entry into the role's known state.
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const log = logs[index]!;
    if (!log.action_type.startsWith("ROLE_") || !log.target_id) continue;
    const prior = known.get(log.target_id);
    result.set(log.id, prior ? { ...prior } : undefined);
    const changes = asRecord(log.changes);
    const next: RoleState = { ...prior };
    const name = split(changes.name).after;
    const color = split(changes.color).after;
    const bits = split(changes.permissions).after;
    if (typeof name === "string") next.name = name;
    if ("color" in changes)
      next.color = typeof color === "string" ? color : null;
    else if (log.action_type === "ROLE_CREATE") next.color = null;
    if (typeof bits === "number") next.permissions = bits;
    known.set(log.target_id, next);
  }
  return result;
}

export function describeAudit(
  log: ServerAuditLog,
  lookup: AuditLookup,
  previousRole?: RoleState,
): AuditEntry {
  const changes = asRecord(log.changes);
  const target = (kind: TargetKind) =>
    resolveTarget(kind, log.target_id, lookup, changes);

  switch (log.action_type) {
    case "SERVER_UPDATE":
      return {
        verb: "updated",
        target: target("server"),
        details: serverDetails(changes),
      };
    case "CHANNEL_CREATE":
      return {
        verb: "created channel",
        target: target("channel"),
        details: [],
      };
    case "CHANNEL_UPDATE":
      return {
        verb: "updated channel",
        target: target("channel"),
        details: channelDetails(changes),
      };
    case "CHANNEL_DELETE":
      return {
        verb: "deleted channel",
        target: target("channel"),
        details: [],
      };
    case "ROLE_CREATE":
      return {
        verb: "created role",
        target: target("role"),
        details: roleDetails(changes, undefined, true),
      };
    case "ROLE_UPDATE":
      return {
        verb: "updated role",
        target: target("role"),
        details: roleDetails(changes, previousRole, false),
      };
    case "ROLE_DELETE":
      return { verb: "deleted role", target: target("role"), details: [] };
    case "MEMBER_KICK":
      return { verb: "kicked", target: target("member"), details: [] };
    case "MEMBER_BAN":
    case "MEMBER_BAN_ADD":
      return { verb: "banned", target: target("member"), details: [] };
    case "MEMBER_UNBAN":
    case "MEMBER_BAN_REMOVE":
      return { verb: "unbanned", target: target("member"), details: [] };
    case "MEMBER_ROLE_UPDATE": {
      const ids = split(changes.added_roles ?? changes.roles).after;
      const names = Array.isArray(ids)
        ? ids
            .map((id) =>
              typeof id === "string" ? lookup.roles.get(id) : undefined,
            )
            .filter((name): name is string => Boolean(name))
        : [];
      return {
        verb: "changed the roles of",
        target: target("member"),
        details:
          names.length > 0
            ? [{ type: "list", label: "Roles", items: names }]
            : [],
      };
    }
    default: {
      // Unknown types still read as a sentence: NOUN_VERB -> "verbed noun".
      const parts = log.action_type.split("_").filter(Boolean);
      const last = parts[parts.length - 1] ?? "";
      const verb = VERBS[last];
      const noun = (verb ? parts.slice(0, -1) : parts).join(" ").toLowerCase();
      const kind = kindFromType(log.action_type);
      return {
        verb: verb
          ? `${verb} ${kind === "member" ? "" : noun}`.trim()
          : `changed ${noun}`,
        target: log.target_id || kind === "server" ? target(kind) : null,
        details: [],
      };
    }
  }
}
