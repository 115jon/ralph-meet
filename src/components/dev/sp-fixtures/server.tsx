/**
 * Server settings fixtures: every tab, and the loading / empty / error states
 * the audit asked for.
 *
 *   sp-server                overview (owner)
 *   sp-server-roles          roles list + editor
 *   sp-server-invites        invites list
 *   sp-server-invites-paused invites paused banner
 *   sp-server-bans           bans list
 *   sp-server-bans-empty     no bans
 *   sp-server-bans-loading   bans loading
 *   sp-server-audit          audit log list
 *   sp-server-audit-empty    no entries
 *   sp-server-audit-error    load failed
 *   sp-server-audit-loading  loading
 *   sp-server-roles-edit     a role open in the editor (pushed on phones)
 *   sp-server-delete         delete confirm armed (owner)
 *   sp-server-member         moderator without Manage server: fewer pages
 *   sp-server-invites-error  invite list failed to load
 *   sp-server-invite-modal   the "Invite people" dialog (InviteModal)
 */

import InviteModal from "@/components/chat/InviteModal";
import ServerSettingsModal, {
  type ServerSettingsTab,
} from "@/components/chat/ServerSettingsModal";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";
import type { Invite, Role, ServerAuditLog } from "@/lib/types";
import type { ReactNode } from "react";
import {
  at,
  fail,
  inMinutes,
  ok,
  pending,
  useApiStub,
  type StubRoute,
} from "./api-stub";

export const SERVER_SURFACES = [
  "sp-server",
  "sp-server-roles",
  "sp-server-invites",
  "sp-server-invites-paused",
  "sp-server-bans",
  "sp-server-bans-empty",
  "sp-server-bans-loading",
  "sp-server-audit",
  "sp-server-audit-empty",
  "sp-server-audit-error",
  "sp-server-audit-loading",
  "sp-server-roles-edit",
  "sp-server-delete",
  "sp-server-member",
  "sp-server-invites-error",
  "sp-server-invite-modal",
] as const;

export const FIXTURE_ROLES: Role[] = [
  {
    id: "r-everyone",
    server_id: "s-1",
    name: "@everyone",
    color: null,
    permissions:
      PERMISSIONS.VIEW_CHANNELS |
      PERMISSIONS.SEND_MESSAGES |
      PERMISSIONS.ADD_REACTIONS |
      PERMISSIONS.CONNECT |
      PERMISSIONS.SPEAK,
    position: 0,
    is_default: true,
    created_at: at(9000),
  },
  {
    id: "r-admin",
    server_id: "s-1",
    name: "Admin",
    color: "#e5484d",
    permissions: ALL_PERMISSIONS,
    position: 3,
    is_default: false,
    created_at: at(8000),
  },
  {
    id: "r-mod",
    server_id: "s-1",
    name: "Moderator",
    color: "#3e9b4f",
    permissions:
      PERMISSIONS.KICK_MEMBERS |
      PERMISSIONS.BAN_MEMBERS |
      PERMISSIONS.MANAGE_MESSAGES |
      PERMISSIONS.VIEW_AUDIT_LOG,
    position: 2,
    is_default: false,
    created_at: at(7000),
  },
  {
    id: "r-crew",
    server_id: "s-1",
    name: "Crew",
    color: "#0090ff",
    permissions: PERMISSIONS.CREATE_INVITE | PERMISSIONS.VIDEO,
    position: 1,
    is_default: false,
    created_at: at(6000),
  },
];

const invites: Invite[] = [
  {
    code: "hq-crew-7k2",
    server_id: "s-1",
    channel_id: "ch-general",
    channel_name: "general",
    inviter_id: "u-me",
    inviter: { id: "u-me", username: "jon", display_name: "Jon" },
    uses: 4,
    max_uses: 10,
    expires_at: inMinutes(60 * 20),
    created_at: at(240),
  },
  {
    code: "lounge-open",
    server_id: "s-1",
    channel_id: "ch-lounge",
    channel_name: "Lounge",
    inviter_id: "u-ada",
    inviter: { id: "u-ada", username: "ada", display_name: "Ada Lovelace" },
    uses: 31,
    created_at: at(4000),
  },
  {
    code: "temp-pass-q9",
    server_id: "s-1",
    channel_id: "ch-general",
    channel_name: "general",
    inviter_id: "u-grace",
    inviter: { id: "u-grace", username: "grace", display_name: "Grace Hopper" },
    uses: 1,
    max_uses: 1,
    temporary: true,
    expires_at: inMinutes(25),
    created_at: at(5),
  },
];

const bans = [
  {
    server_id: "s-1",
    user_id: "u-spam",
    username: "free_nitro_bot",
    reason: "Posting phishing links in #general",
    banned_by_username: "jon",
    created_at: at(1440),
  },
  {
    server_id: "s-1",
    user_id: "u-troll",
    username: "capslock_carl",
    reason: undefined,
    banned_by_username: "ada",
    created_at: at(20000),
  },
];

const jon = { id: "u-me", username: "jon", display_name: "Jon" };
const ada = { id: "u-ada", username: "ada", display_name: "Ada Lovelace" };
const grace = {
  id: "u-grace",
  username: "grace",
  display_name: "Grace Hopper",
};

/** Newest first, with the real action types (lib/audit-logger.ts). */
const auditLogs: ServerAuditLog[] = [
  {
    id: "a-1",
    server_id: "s-1",
    actor_id: "u-me",
    actor: jon,
    action_type: "ROLE_UPDATE",
    target_id: "r-mod",
    changes: {
      name: "Moderator",
      color: "#3e9b4f",
      permissions:
        PERMISSIONS.KICK_MEMBERS |
        PERMISSIONS.BAN_MEMBERS |
        PERMISSIONS.MANAGE_MESSAGES |
        PERMISSIONS.VIEW_AUDIT_LOG,
    },
    created_at: at(12),
  },
  {
    id: "a-2",
    server_id: "s-1",
    actor_id: "u-me",
    actor: jon,
    action_type: "MEMBER_ROLE_UPDATE",
    target_id: "u-grace",
    changes: { added_roles: ["r-crew"] },
    created_at: at(240),
  },
  {
    id: "a-3",
    server_id: "s-1",
    actor_id: "u-ada",
    actor: ada,
    action_type: "MEMBER_BAN",
    target_id: "u-spam",
    reason: "Posting phishing links in #general",
    created_at: at(1440),
  },
  {
    id: "a-4",
    server_id: "s-1",
    actor_id: "u-grace",
    actor: grace,
    action_type: "CHANNEL_UPDATE",
    target_id: "ch-general",
    changes: { name: "general", description: "Day-to-day chat" },
    created_at: at(3000),
  },
  {
    id: "a-5",
    server_id: "s-1",
    actor_id: "u-me",
    actor: jon,
    action_type: "ROLE_CREATE",
    target_id: "r-mod",
    changes: {
      name: "Moderator",
      color: "#3e9b4f",
      permissions:
        PERMISSIONS.KICK_MEMBERS |
        PERMISSIONS.BAN_MEMBERS |
        PERMISSIONS.VIEW_AUDIT_LOG,
    },
    created_at: at(5000),
  },
  {
    id: "a-6",
    server_id: "s-1",
    actor_id: "u-me",
    actor: jon,
    action_type: "SERVER_UPDATE",
    changes: { name: "Ralph HQ", allow_share_indexing: false },
    created_at: at(9000),
  },
];

function serverRoutes(surface: string): StubRoute[] {
  return [
    {
      path: /^\/api\/servers\/s-1\/roles$/,
      method: "GET",
      reply: () => ok(FIXTURE_ROLES),
    },
    {
      path: /^\/api\/servers\/s-1\/invites$/,
      method: "GET",
      reply: () =>
        surface === "sp-server-invites-error"
          ? fail(500, "D1_ERROR: no such table: invites")
          : ok(invites),
    },
    {
      path: /^\/api\/servers\/s-1\/invites$/,
      method: "POST",
      reply: () => ok({ code: "hq-crew-7k2" }),
    },
    {
      path: /^\/api\/servers\/s-1\/settings$/,
      method: "GET",
      reply: () =>
        ok({ invites_paused: surface === "sp-server-invites-paused" ? 1 : 0 }),
    },
    {
      path: /^\/api\/servers\/s-1\/bans$/,
      method: "GET",
      reply: () =>
        surface === "sp-server-bans-loading"
          ? pending()
          : ok(surface === "sp-server-bans-empty" ? [] : bans),
    },
    {
      path: /^\/api\/servers\/s-1\/audit-logs$/,
      method: "GET",
      reply: () =>
        surface === "sp-server-audit-loading"
          ? pending()
          : surface === "sp-server-audit-error"
            ? fail(500, "D1_ERROR: no such table: audit_logs")
            : ok(surface === "sp-server-audit-empty" ? [] : auditLogs),
    },
    {
      path: /^\/api\/servers\/s-1\/members$/,
      method: "GET",
      reply: () =>
        ok([
          { user_id: "u-me", user: jon },
          { user_id: "u-ada", user: ada },
          { user_id: "u-grace", user: grace },
        ]),
    },
  ];
}

const MODERATOR_PERMISSIONS =
  PERMISSIONS.KICK_MEMBERS |
  PERMISSIONS.BAN_MEMBERS |
  PERMISSIONS.MANAGE_MESSAGES |
  PERMISSIONS.VIEW_AUDIT_LOG;

function tabFor(surface: string): ServerSettingsTab {
  if (surface.startsWith("sp-server-roles")) return "roles";
  if (surface.startsWith("sp-server-invites")) return "invites";
  if (surface.startsWith("sp-server-bans")) return "bans";
  if (surface.startsWith("sp-server-audit")) return "audit";
  return "overview";
}

function ServerFixture({ surface }: { surface: string }) {
  useApiStub(serverRoutes(surface));
  if (surface === "sp-server-invite-modal") {
    return (
      <InviteModal
        open
        serverId="s-1"
        serverName="Ralph HQ"
        onClose={() => {}}
      />
    );
  }
  const member = surface === "sp-server-member";
  return (
    <ServerSettingsModal
      open
      serverId="s-1"
      ownerId={member ? "u-ada" : "u-me"}
      serverName="Ralph HQ"
      iconUrl={null}
      userPermissions={member ? MODERATOR_PERMISSIONS : ALL_PERMISSIONS}
      onClose={() => {}}
      onUpdated={() => {}}
      onDeleted={() => {}}
      initialTab={member ? undefined : tabFor(surface)}
      initialRoleId={surface === "sp-server-roles-edit" ? "r-mod" : undefined}
      initialConfirmDelete={surface === "sp-server-delete"}
    />
  );
}

export function renderServerFixture(
  surface: string,
  shell: ReactNode,
): ReactNode | null {
  if (!(SERVER_SURFACES as readonly string[]).includes(surface)) return null;
  return (
    <div className="relative h-full w-full">
      {shell}
      <ServerFixture surface={surface} />
    </div>
  );
}
