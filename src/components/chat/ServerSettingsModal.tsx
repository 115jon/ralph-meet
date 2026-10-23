/**
 * Server settings on the shared settings workbench (design-system 12.6, 12.8,
 * 13.1): nav column + titled page on desktop, push navigation with a back
 * step on phones. Each page lives in `server-settings/` or its own file.
 */

import {
  WIDE_QUERY,
  isWideViewport,
  useMediaQuery,
} from "@/hooks/useMediaQuery";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { useChatStore } from "@/stores/chat-store";
import { useLayoutEffect, useState } from "react";
import AuditLogTab from "./AuditLogTab";
import InvitesTab from "./InvitesTab";
import RoleManagement from "./RoleManagement";
import { BansPage } from "./server-settings/BansPage";
import {
  OverviewPage,
  OverviewSaveBar,
  useOverviewForm,
  type ServerUpdates,
} from "./server-settings/OverviewPage";
import {
  SettingsWorkbench,
  WorkbenchNav,
  type WorkbenchNavItem,
} from "./settings/SettingsWorkbench";
import { useWorkbenchNav } from "./settings/useWorkbenchNav";

export type ServerSettingsTab =
  | "overview"
  | "roles"
  | "invites"
  | "bans"
  | "audit";

interface ServerSettingsModalProps {
  open: boolean;
  serverId: string;
  ownerId: string;
  serverName: string;
  iconUrl: string | null;
  allowPublicShares?: boolean;
  showSourceInShares?: boolean;
  allowShareIndexing?: boolean;
  userPermissions: number;
  onClose: () => void;
  onUpdated: (updates: ServerUpdates) => void;
  onDeleted: () => void;
  /** Page to open on; pushed straight into it on phones. */
  initialTab?: ServerSettingsTab;
  /** Roles page: open this role in the editor. */
  initialRoleId?: string;
  /** Overview: open with the delete confirm armed (fixtures). */
  initialConfirmDelete?: boolean;
}

const PAGE_TITLES: Record<ServerSettingsTab, string> = {
  overview: "Overview",
  roles: "Roles",
  invites: "Invites",
  bans: "Bans",
  audit: "Audit log",
};

export default function ServerSettingsModal({
  open,
  serverId,
  ownerId,
  serverName,
  iconUrl,
  allowPublicShares = true,
  showSourceInShares = false,
  allowShareIndexing = false,
  userPermissions,
  onClose,
  onUpdated,
  onDeleted,
  initialTab,
  initialRoleId,
  initialConfirmDelete = false,
}: ServerSettingsModalProps) {
  const currentUserId = useChatStore((state) => state.user?.id);
  const wide = useMediaQuery(WIDE_QUERY);

  const isAdministrator = hasPermission(
    userPermissions,
    PERMISSIONS.ADMINISTRATOR,
  );
  const can = (permission: number) =>
    isAdministrator || hasPermission(userPermissions, permission);
  const canManageServer = can(PERMISSIONS.MANAGE_SERVER);
  const canManageRoles = can(PERMISSIONS.MANAGE_ROLES);
  const canBan = can(PERMISSIONS.BAN_MEMBERS);
  const canViewAuditLog = canManageServer || can(PERMISSIONS.VIEW_AUDIT_LOG);
  const isOwner = currentUserId === ownerId;

  const items: (WorkbenchNavItem & { id: ServerSettingsTab })[] = [
    { id: "overview", label: "Overview", icon: "settings" },
    ...(canManageRoles
      ? [{ id: "roles" as const, label: "Roles", icon: "shield" as const }]
      : []),
    ...(canManageServer
      ? [{ id: "invites" as const, label: "Invites", icon: "invite" as const }]
      : []),
    ...(canBan
      ? [{ id: "bans" as const, label: "Bans", icon: "ban" as const }]
      : []),
    ...(canViewAuditLog
      ? [
          {
            id: "audit" as const,
            label: "Audit log",
            icon: "auditLog" as const,
          },
        ]
      : []),
  ];
  const allowed = (tab: ServerSettingsTab | undefined) =>
    tab !== undefined && items.some((item) => item.id === tab);

  const nav = useWorkbenchNav<ServerSettingsTab>(
    allowed(initialTab) ? initialTab! : "overview",
  );
  const { reset } = nav;
  const active = allowed(nav.active) ? nav.active : "overview";

  // A requested page opens pushed on phones, not on the list.
  useLayoutEffect(() => {
    if (initialTab) reset(nav.active, false);
    // Mount only: later prop changes must not yank the person around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Roles: the pushed editor (phones and medium widths).
  const splitRoles = wide;
  // Read the viewport directly: the media-query store reports its last
  // value until it subscribes, which is after this first render.
  const [roleEditorOpen, setRoleEditorOpen] = useState(
    () => Boolean(initialRoleId) && initialTab === "roles" && !isWideViewport(),
  );
  const [roleTitle, setRoleTitle] = useState<string | null>(null);
  const rolePushed =
    active === "roles" && !splitRoles && roleEditorOpen && roleTitle !== null;

  const form = useOverviewForm({
    serverId,
    serverName,
    iconUrl,
    allowPublicShares,
    showSourceInShares,
    allowShareIndexing,
    onUpdated,
  });

  const select = (id: string) => {
    setRoleEditorOpen(false);
    nav.go(id as ServerSettingsTab);
  };

  let page;
  switch (active) {
    case "roles":
      page = (
        <RoleManagement
          serverId={serverId}
          initialRoleId={initialRoleId}
          split={splitRoles}
          editorOpen={roleEditorOpen}
          onEditorOpenChange={setRoleEditorOpen}
          onEditorTitle={setRoleTitle}
        />
      );
      break;
    case "invites":
      page = <InvitesTab serverId={serverId} serverName={serverName} />;
      break;
    case "bans":
      page = <BansPage serverId={serverId} />;
      break;
    case "audit":
      page = <AuditLogTab serverId={serverId} />;
      break;
    default:
      page = (
        <OverviewPage
          form={form}
          serverId={serverId}
          serverName={serverName}
          canEdit={canManageServer}
          isOwner={isOwner}
          initialConfirmDelete={initialConfirmDelete}
          onDeleted={() => {
            onDeleted();
            onClose();
          }}
        />
      );
  }

  return (
    <SettingsWorkbench
      open={open}
      onClose={onClose}
      title="Server settings"
      subtitle={serverName}
      closeLabel="Close server settings"
      nav={
        <WorkbenchNav
          groups={[{ items }]}
          activeId={active}
          onSelect={select}
        />
      }
      activeId={active}
      showList={nav.showList}
      onShowListChange={nav.setShowList}
      pageTitle={rolePushed ? roleTitle : PAGE_TITLES[active]}
      pageKey={active}
      back={
        rolePushed
          ? { label: "Back to roles", onBack: () => setRoleEditorOpen(false) }
          : undefined
      }
      width={active === "roles" && splitRoles ? "full" : "prose"}
      footer={
        active === "overview" && canManageServer ? (
          <OverviewSaveBar form={form} />
        ) : undefined
      }
    >
      {page}
    </SettingsWorkbench>
  );
}
