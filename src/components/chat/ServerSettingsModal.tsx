import { BaseModal } from "@/components/ui/BaseModal";
import { apiDelete, apiGet, apiPatch, apiUpload } from '@/lib/api-client';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat-store';
import { useCallback, useReducer, useRef, useState } from 'react';
import AuditLogTab from './AuditLogTab';
import { AlertTriangle, ClipboardList, Link, Loader2, Plus, Settings2, Shield, Trash2, X } from "./Icons";
import InvitesTab from './InvitesTab';
import RoleManagement from './RoleManagement';

interface ServerSettingsModalProps {
  serverId: string;
  ownerId: string;
  serverName: string;
  iconUrl: string | null;
  allowPublicShares?: boolean;
  showSourceInShares?: boolean;
  allowShareIndexing?: boolean;
  userPermissions: number;
  onClose: () => void;
  onUpdated: (updates: { name?: string; icon_url?: string | null; allow_public_shares?: boolean; show_source_in_shares?: boolean; allow_share_indexing?: boolean }) => void;
  onDeleted: () => void;
  isClosing?: boolean;
}

function SettingsSidebar({
  initialServerName,
  activeTab,
  setActiveTab,
  canManageRoles,
  canBan,
  isAdmin,
  canViewAuditLog,
  fetchBans
}: any) {
  return (
    <div className="w-full md:w-[218px] flex flex-row md:flex-col shrink-0 bg-rm-server-bar pt-2 md:pt-[60px] pb-2 px-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden custom-scrollbar border-b md:border-b-0 md:border-r border-rm-border/50 gap-2 md:gap-0">
      <div className="hidden md:block mb-2 px-2">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted truncate block w-[180px]" title={initialServerName}>
          {initialServerName}
        </h2>
      </div>
      <button type="button"
        onClick={() => setActiveTab('overview')}
        className={cn(
          "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
          activeTab === 'overview' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
        )}
      >
        <Settings2 className="h-4 w-4" /> Overview
      </button>

      {canManageRoles && (
        <button type="button"
          onClick={() => setActiveTab('roles')}
          className={cn(
            "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
            activeTab === 'roles' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
          )}
        >
          <Shield className="h-4 w-4" /> Roles
        </button>
      )}

      {canBan && (
        <button type="button"
          onClick={() => { setActiveTab('bans'); fetchBans(); }}
          className={cn(
            "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
            activeTab === 'bans' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
          )}
        >
          <AlertTriangle className="h-4 w-4" /> Bans
        </button>
      )}

      {isAdmin && (
        <button type="button"
          onClick={() => setActiveTab('invites')}
          className={cn(
            "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
            activeTab === 'invites' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
          )}
        >
          <Link className="h-4 w-4" /> Invites
        </button>
      )}

      {canViewAuditLog && (
        <button type="button"
          onClick={() => setActiveTab('audit')}
          className={cn(
            "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
            activeTab === 'audit' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
          )}
        >
          <ClipboardList className="h-4 w-4" /> Audit Log
        </button>
      )}

      <div className="my-3 h-px bg-rm-border/60 mx-2" />
    </div>
  );
}

function BansTab({ bansLoading, bans, handleUnban }: any) {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full">
      <h2 id="server-settings-title" className="mb-6 text-xl font-bold text-rm-text">Bans</h2>
      {bansLoading ? (
        <div className="flex items-center gap-2 text-rm-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading bans…
        </div>
      ) : bans.length === 0 ? (
        <p className="text-rm-text-muted text-sm">No banned users.</p>
      ) : (
        <div className="space-y-2 max-w-xl">
          {bans.map((ban: any) => (
            <div key={ban.user_id} className="flex items-center gap-3 rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-3 transition-colors hover:border-rm-text-muted/20">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-sm font-bold text-destructive">
                {(ban.username ?? '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-rm-text truncate">{ban.username ?? ban.user_id}</p>
                {ban.reason && <p className="text-xs text-rm-text-muted truncate">Reason: {ban.reason}</p>}
                <p className="text-[10px] text-rm-text-muted">Banned by {ban.banned_by_username ?? 'Unknown'} • {new Date(ban.created_at).toLocaleDateString()}</p>
              </div>
              <button type="button"
                onClick={() => handleUnban(ban.user_id)}
                className="flex items-center gap-1.5 rounded-lg border border-rm-border px-3 py-1.5 text-xs font-semibold text-rm-text-secondary transition-all hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" /> Unban
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewTab({
  isAdmin, isOwner, initialServerName, name, setName, saving, handleSave,
  confirmDelete, setConfirmDelete, deleteText, setDeleteText, handleDelete,
  iconFile, setIconFile, iconPreview, setIconPreview, iconError, setIconError,
  removeIcon, setRemoveIcon, currentIconUrl, fileInputRef,
  allowPublicShares, setAllowPublicShares, showSourceInShares, setShowSourceInShares,
  allowShareIndexing, setAllowShareIndexing
}: any) {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full">
      <h2 id="server-settings-title" className="mb-6 text-xl font-bold text-rm-text">
        Server Overview
      </h2>

      <div className="space-y-8 max-w-xl">
        {isAdmin && (
          <div className="space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted block">Server Icon</span>
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-rm-border bg-rm-bg-surface transition-all hover:border-primary/50 hover:bg-rm-bg-elevated"
                aria-label={(iconPreview || (currentIconUrl && !removeIcon)) ? "Change server icon" : "Upload server icon"}
              >
                {(iconPreview || (currentIconUrl && !removeIcon)) ? (
                  <>
                    <img
                      src={iconPreview ?? currentIconUrl!}
                      alt="Server icon"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="text-[10px] font-bold uppercase text-white">Change</span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-0.5">
                    <Plus className="h-5 w-5 text-rm-text-muted/40 transition-colors group-hover:text-primary" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-rm-text-muted/40 group-hover:text-primary">
                      Icon
                    </span>
                  </div>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                className="hidden"
                aria-label="Upload server icon"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (!file.type.startsWith('image/')) { setIconError('Only image files are allowed'); return; }
                    if (file.size > 8 * 1024 * 1024) { setIconError('Image too large (max 8MB)'); return; }
                    setIconError(null);
                    setIconFile(file);
                    setRemoveIcon(false);
                    if (iconPreview) URL.revokeObjectURL(iconPreview);
                    setIconPreview(URL.createObjectURL(file));
                  }
                  e.target.value = '';
                }}
              />
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-rm-text-muted leading-relaxed">
                  Recommended size: 512×512. Supports PNG, JPG, GIF, and WebP.
                </p>
                {(iconPreview || currentIconUrl) && (
                  <button type="button"
                    onClick={() => {
                      setIconFile(null);
                      setRemoveIcon(true);
                      if (iconPreview) { URL.revokeObjectURL(iconPreview); setIconPreview(null); }
                    }}
                    className="w-fit text-xs font-bold uppercase tracking-wider text-rm-text-muted hover:text-destructive transition-colors"
                  >
                    Remove Icon
                  </button>
                )}
              </div>
            </div>
            {iconError && <p className="text-xs font-medium text-red-800 dark:text-red-400">{iconError}</p>}
          </div>
        )}

        <div className="space-y-3">
          <label htmlFor="server-name-setting" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted block">Server Name</label>
          <input
            id="server-name-setting"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            className="w-full max-w-sm rounded-lg border border-rm-border bg-rm-bg-surface px-4 py-2.5 text-[15px] text-rm-text outline-none transition-all placeholder:text-rm-text-muted/40 focus:border-primary/40 focus:ring-2 focus:ring-primary/20 disabled:opacity-40"
          />
        </div>
        {isAdmin && (
          <div className="space-y-4 rounded-xl border border-rm-border bg-rm-bg-surface p-4">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">Public Sharing</h3>
              <p className="mt-1 text-[12px] leading-5 text-rm-text-muted">
                Controls whether messages in this server can be snapshot-shared to public no-account links.
              </p>
            </div>
            {[
              ["Allow public message shares", allowPublicShares, setAllowPublicShares],
              ["Show server and channel on shares", showSourceInShares, setShowSourceInShares],
              ["Allow search indexing for shares", allowShareIndexing, setAllowShareIndexing],
            ].map(([label, checked, setter]: any) => (
              <label key={label} className="flex items-center justify-between gap-4 rounded-lg border border-rm-border bg-rm-bg-primary px-3 py-2">
                <span className="text-sm font-medium text-rm-text-secondary">{label}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setter(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            ))}
          </div>
        )}

        {isAdmin && (
          <button type="button"
            onClick={handleSave}
            disabled={saving || (!name.trim() && !iconFile && !removeIcon)}
            className="flex max-w-fit items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      {isOwner && (
        <>
          <div className="my-8 h-px bg-rm-border" />
          <div className="space-y-4 rounded-xl border border-destructive/20 bg-destructive/5 p-5">
            <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Danger Zone
            </h3>
            <p className="text-sm text-rm-text-secondary mb-2">
              Deleting a server is permanent and cannot be undone. All messages, roles, and channels will be lost.
            </p>
            {!confirmDelete ? (
              <button type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition-all hover:brightness-110"
              >
                Delete Server
              </button>
            ) : (
              <div className="space-y-3 mt-4 bg-rm-bg-surface/50 p-4 rounded-xl border border-destructive/10">
                <p className="text-sm text-rm-text-muted">
                  Type <strong className="text-rm-text font-bold select-all">{initialServerName}</strong> to confirm deletion:
                </p>
                <input
                  aria-label="Confirm server name for deletion"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder="Server name"
                  className="w-full max-w-sm rounded-xl border border-destructive/20 bg-rm-bg-surface px-4 py-2.5 text-sm text-rm-text outline-none placeholder:text-rm-text-muted/40 focus:border-destructive/30 focus:ring-2 focus:ring-destructive/20"
                />
                <div className="flex gap-2 pt-2">
                  <button type="button"
                    onClick={handleDelete}
                    disabled={deleteText !== initialServerName}
                    className="rounded-xl bg-destructive px-5 py-2 text-sm font-semibold text-destructive-foreground transition-all hover:brightness-110 disabled:opacity-40"
                  >
                    Delete Forever
                  </button>
                  <button type="button"
                    onClick={() => {
                      setConfirmDelete(false);
                      setDeleteText('');
                    }}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-rm-text-muted hover:text-rm-text transition-colors outline-none"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function ServerSettingsModal({
  serverId,
  ownerId,
  serverName: initialServerName,
  iconUrl: initialIconUrl,
  allowPublicShares: initialAllowPublicShares = true,
  showSourceInShares: initialShowSourceInShares = false,
  allowShareIndexing: initialAllowShareIndexing = false,
  userPermissions,
  onClose,
  onUpdated,
  onDeleted,
  isClosing,
}: ServerSettingsModalProps) {
  const currentUserId = useChatStore((state) => state.user?.id);
  const [state, dispatch] = useReducer(
    (prev: any, next: any) => ({ ...prev, ...(typeof next === 'function' ? next(prev) : next) }),
    {
      name: initialServerName,
      saving: false,
      confirmDelete: false,
      deleteText: '',
      activeTab: 'overview' as 'overview' | 'roles' | 'invites' | 'bans' | 'audit',
      iconFile: null as File | null,
      iconPreview: null as string | null,
      iconError: null as string | null,
      removeIcon: false,
      currentIconUrl: initialIconUrl,
      allowPublicShares: initialAllowPublicShares,
      showSourceInShares: initialShowSourceInShares,
      allowShareIndexing: initialAllowShareIndexing,
    }
  );

  const {
    name, saving, confirmDelete, deleteText, activeTab,
    iconFile, iconPreview, iconError, removeIcon, currentIconUrl,
    allowPublicShares, showSourceInShares, allowShareIndexing
  } = state;

  const setName = (val: string) => dispatch({ name: val });
  const setSaving = (val: boolean) => dispatch({ saving: val });
  const setConfirmDelete = (val: boolean) => dispatch({ confirmDelete: val });
  const setDeleteText = (val: string) => dispatch({ deleteText: val });
  const setActiveTab = (val: any) => dispatch({ activeTab: val });
  const setIconFile = (val: any) => dispatch({ iconFile: val });
  const setIconPreview = (val: any) => dispatch({ iconPreview: val });
  const setIconError = (val: any) => dispatch({ iconError: val });
  const setRemoveIcon = (val: any) => dispatch({ removeIcon: val });
  const setCurrentIconUrl = (val: any) => dispatch({ currentIconUrl: val });
  const setAllowPublicShares = (val: boolean) => dispatch({ allowPublicShares: val });
  const setShowSourceInShares = (val: boolean) => dispatch({ showSourceInShares: val });
  const setAllowShareIndexing = (val: boolean) => dispatch({ allowShareIndexing: val });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = hasPermission(userPermissions, PERMISSIONS.MANAGE_SERVER) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const isOwner = currentUserId === ownerId;
  const canManageRoles = hasPermission(userPermissions, PERMISSIONS.MANAGE_ROLES) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const canBan = hasPermission(userPermissions, PERMISSIONS.BAN_MEMBERS) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const canViewAuditLog = hasPermission(userPermissions, PERMISSIONS.VIEW_AUDIT_LOG) || hasPermission(userPermissions, PERMISSIONS.MANAGE_SERVER) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);

  const [bans, setBans] = useState<Array<{ server_id: string; user_id: string; username?: string; avatar_url?: string; reason?: string; banned_by_username?: string; created_at: string }>>([]);
  const [bansLoading, setBansLoading] = useState(false);

  const fetchBans = useCallback(async () => {
    if (!canBan) return;
    setBansLoading(true);
    try {
      const data = await apiGet<Array<{ server_id: string; user_id: string; username?: string; avatar_url?: string; reason?: string; banned_by_username?: string; created_at: string }>>(`/api/servers/${serverId}/bans`);
      setBans(data);
    } catch (err: any) {
      console.error("Failed to fetch bans:", err);
    } finally {
      setBansLoading(false);
    }
  }, [canBan, serverId]);

  const handleUnban = async (userId: string) => {
    try {
      await apiDelete(`/api/servers/${serverId}/bans`, { user_id: userId });
      setBans((prev) => prev.filter((b) => b.user_id !== userId));
    } catch (err: any) {
      console.error("Failed to unban:", err);
    }
  };





  const handleSave = async () => {
    if (!name.trim() && !iconFile && !removeIcon) return;
    setSaving(true);
    setIconError(null);
    try {
      let finalIconUrl: string | null | undefined;

      if (iconFile) {
        const formData = new FormData();
        formData.append('file', iconFile);
        try {
          const data = await apiUpload<{ url: string }>('/api/servers/icon-upload', formData);
          finalIconUrl = data.url;
        } catch (err) {
          setIconError((err as Error).message || 'Failed to upload icon');
          setSaving(false);
          return;
        }
      } else if (removeIcon) {
        finalIconUrl = null;
      }

      const updates: { name?: string; icon_url?: string | null; allow_public_shares?: boolean; show_source_in_shares?: boolean; allow_share_indexing?: boolean } = {};
      if (name.trim() !== initialServerName) updates.name = name.trim();
      if (finalIconUrl !== undefined || removeIcon) {
        updates.icon_url = finalIconUrl;
      }
      updates.allow_public_shares = allowPublicShares;
      updates.show_source_in_shares = showSourceInShares;
      updates.allow_share_indexing = allowShareIndexing;

      if (Object.keys(updates).length > 0) {
        await apiPatch(`/api/servers/${serverId}/settings`, updates);

        if (updates.name !== undefined) setName(updates.name);
        if (updates.icon_url !== undefined) setCurrentIconUrl(updates.icon_url);
        onUpdated(updates);
        setIconFile(null);
        if (iconPreview) { URL.revokeObjectURL(iconPreview); setIconPreview(null); }
        setRemoveIcon(false);
      }
    } catch (error) {
      console.error('Error saving server settings:', error);
      setIconError((error as Error).message || 'An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteText !== initialServerName) return;
    try {
      await apiDelete(`/api/servers/${serverId}/settings`);
      onDeleted();
      onClose();
    } catch (err: any) {
      console.error("Failed to delete server:", err);
    }
  };

  return (
    <BaseModal onClose={onClose}>
      <div
        className={cn(
          "fixed inset-0 z-1000 flex flex-col items-center justify-end md:justify-center p-0 md:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 pointer-events-none",
          isClosing && "animate-out fade-out"
        )}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        role="presentation"
      >
        <dialog
          open
          className={cn(
            "relative m-0 flex h-full w-full flex-col overflow-hidden bg-rm-bg-primary p-0 shadow-2xl pointer-events-auto outline-none md:h-full md:max-h-[820px] md:max-w-[1040px] md:flex-row md:rounded-xl md:border border-rm-border animate-in slide-in-from-bottom-full md:slide-in-from-bottom-0 md:fade-in duration-300 md:duration-200",
            isClosing && "animate-out slide-out-to-bottom-full md:slide-out-to-bottom-0 md:fade-out"
          )}
          aria-label="Server settings"
        >
          <div
            className="w-full flex justify-between items-center pb-3 px-4 md:hidden bg-rm-server-bar shrink-0 border-b border-rm-border/50"
            style={{ paddingTop: 'calc(16px + var(--safe-area-top, 0px))' }}
          >
            <h2 className="text-[13px] font-bold tracking-widest text-rm-text-muted truncate">
              {initialServerName}
            </h2>
            <button type="button"
              onClick={onClose}
              className="p-1 rounded-full bg-rm-bg-surface text-rm-text flex items-center justify-center hover:bg-rm-bg-hover active:scale-95 transition-all"
              aria-label="Close server settings"
            >
              <X size={18} />
            </button>
          </div>

          <SettingsSidebar
            initialServerName={initialServerName}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            canManageRoles={canManageRoles}
            canBan={canBan}
            isAdmin={isAdmin}
            canViewAuditLog={canViewAuditLog}
            fetchBans={fetchBans}
          />

          <div className="flex-1 flex flex-col bg-rm-bg-primary relative overflow-hidden">
            <div className="absolute right-6 top-6 z-50 flex-col items-center gap-1 hidden md:flex">
              <button type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-rm-border text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all group"
                aria-label="Close server settings"
              >
                <X size={18} />
              </button>
              <span className="text-[11px] font-bold text-rm-text-muted group-hover:text-rm-text-secondary">
                ESC
              </span>
            </div>

            <div
              className="flex-1 overflow-y-auto custom-scrollbar px-[20px] md:px-[40px] pt-[20px] md:pt-[60px]"
              style={{ paddingBottom: 'calc(40px + var(--safe-area-bottom, 0px))' }}
            >
              {activeTab === 'roles' ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h2 id="server-settings-title" className="mb-6 text-xl font-bold text-rm-text">Roles</h2>
                  <RoleManagement serverId={serverId} />
                </div>
              ) : activeTab === 'invites' ? (
                <InvitesTab serverId={serverId} serverName={initialServerName} />
              ) : activeTab === 'bans' ? (
                <BansTab
                  bansLoading={bansLoading}
                  bans={bans}
                  handleUnban={handleUnban}
                />
              ) : activeTab === 'audit' ? (
                <div className="w-full">
                  <AuditLogTab serverId={serverId} />
                </div>
              ) : (
                <OverviewTab
                  isAdmin={isAdmin}
                  isOwner={isOwner}
                  initialServerName={initialServerName}
                  name={name}
                  setName={setName}
                  saving={saving}
                  handleSave={handleSave}
                  confirmDelete={confirmDelete}
                  setConfirmDelete={setConfirmDelete}
                  deleteText={deleteText}
                  setDeleteText={setDeleteText}
                  handleDelete={handleDelete}
                  iconFile={iconFile}
                  setIconFile={setIconFile}
                  iconPreview={iconPreview}
                  setIconPreview={setIconPreview}
                  iconError={iconError}
                  setIconError={setIconError}
                  removeIcon={removeIcon}
                  setRemoveIcon={setRemoveIcon}
                  currentIconUrl={currentIconUrl}
                  fileInputRef={fileInputRef}
                  allowPublicShares={allowPublicShares}
                  setAllowPublicShares={setAllowPublicShares}
                  showSourceInShares={showSourceInShares}
                  setShowSourceInShares={setShowSourceInShares}
                  allowShareIndexing={allowShareIndexing}
                  setAllowShareIndexing={setAllowShareIndexing}
                />
              )}
            </div>
          </div>
        </dialog>
      </div>
    </BaseModal>
  );
}
