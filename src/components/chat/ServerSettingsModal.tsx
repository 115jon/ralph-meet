
import { apiDelete, apiGet, apiPatch, apiUpload } from '@/lib/api-client';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AuditLogTab from './AuditLogTab';
import { AlertTriangle, ClipboardList, Link, Loader2, Plus, Settings2, Shield, Trash2, X } from "./Icons";
import InvitesTab from './InvitesTab';
import RoleManagement from './RoleManagement';

interface ServerSettingsModalProps {
  serverId: string;
  serverName: string;
  iconUrl: string | null;
  userPermissions: number;
  onClose: () => void;
  onUpdated: (updates: { name?: string; icon_url?: string | null }) => void;
  onDeleted: () => void;
}

export default function ServerSettingsModal({
  serverId,
  serverName,
  iconUrl,
  userPermissions,
  onClose,
  onUpdated,
  onDeleted,
}: ServerSettingsModalProps) {
  const [name, setName] = useState(serverName);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'invites' | 'bans' | 'audit'>('overview');

  // Icon upload state
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentIconUrl, setCurrentIconUrl] = useState<string | null>(iconUrl);

  const isAdmin = hasPermission(userPermissions, PERMISSIONS.MANAGE_SERVER) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const isOwner = hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const canManageRoles = hasPermission(userPermissions, PERMISSIONS.MANAGE_ROLES) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const canBan = hasPermission(userPermissions, PERMISSIONS.BAN_MEMBERS) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const canViewAuditLog = hasPermission(userPermissions, PERMISSIONS.VIEW_AUDIT_LOG) || hasPermission(userPermissions, PERMISSIONS.MANAGE_SERVER) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);

  // Bans state
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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Reset state when server details change
  const [prevServerName, setPrevServerName] = useState(serverName);
  const [prevIconUrl, setPrevIconUrl] = useState(iconUrl);

  if (serverName !== prevServerName || iconUrl !== prevIconUrl) {
    setPrevServerName(serverName);
    setPrevIconUrl(iconUrl);
    setName(serverName);
    setCurrentIconUrl(iconUrl);
    setIconFile(null);
    setIconPreview(null);
    setIconError(null);
    setRemoveIcon(false);
  }

  const handleSave = async () => {
    if (!name.trim() && !iconFile && !removeIcon) return; // Allow saving if only removing icon
    setSaving(true);
    setIconError(null);
    try {
      let finalIconUrl: string | null | undefined; // Can be string, null (for removal), or undefined (no change)

      // Upload icon first if changed
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

      const updates: { name?: string; icon_url?: string | null } = {};
      if (name.trim() !== serverName) updates.name = name.trim();
      // Only include icon_url in updates if it was changed (uploaded, removed, or explicitly set to null)
      if (finalIconUrl !== undefined || removeIcon) {
        updates.icon_url = finalIconUrl;
      }

      if (Object.keys(updates).length > 0) {
        await apiPatch(`/api/servers/${serverId}/settings`, updates);

        // Update local state and notify parent
        if (updates.name !== undefined) setName(updates.name);
        if (updates.icon_url !== undefined) setCurrentIconUrl(updates.icon_url);
        onUpdated(updates);
        setIconFile(null);
        if (iconPreview) { URL.revokeObjectURL(iconPreview); setIconPreview(null); }
        setRemoveIcon(false); // Reset removeIcon flag after successful save
      }
    } catch (error) {
      console.error('Error saving server settings:', error);
      setIconError((error as Error).message || 'An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteText !== serverName) return;
    try {
      await apiDelete(`/api/servers/${serverId}/settings`);
      onDeleted();
      onClose();
    } catch (err: any) {
      console.error("Failed to delete server:", err);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-end md:justify-center p-0 md:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 pointer-events-none" onClick={onClose}>
      <div
        className="relative flex flex-col md:flex-row w-full h-[95vh] md:h-full md:max-h-[820px] md:max-w-[1040px] rounded-t-[24px] md:rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary border border-rm-border animate-in slide-in-from-bottom-full md:slide-in-from-bottom-0 md:fade-in duration-300 md:duration-200 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="w-full flex justify-center pt-3 pb-1 md:hidden bg-rm-server-bar shrink-0">
          <div className="w-12 h-1.5 rounded-full bg-rm-bg-hover" />
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-[218px] flex flex-row md:flex-col shrink-0 bg-rm-server-bar pt-2 md:pt-[60px] pb-2 px-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden custom-scrollbar border-b md:border-b-0 md:border-r border-rm-border/50 gap-2 md:gap-0">
          <div className="hidden md:block mb-2 px-2">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted truncate block w-[180px]" title={serverName}>
              {serverName}
            </h2>
          </div>
          <button
            onClick={() => setActiveTab('overview')}
            className={cn(
              "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
              activeTab === 'overview' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
            )}
          >
            <Settings2 className="h-4 w-4" /> Overview
          </button>

          {canManageRoles && (
            <button
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
            <button
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
            <button
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
            <button
              onClick={() => setActiveTab('audit')}
              className={cn(
                "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
                activeTab === 'audit' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
              )}
            >
              <ClipboardList className="h-4 w-4" /> Audit Log
            </button>
          )}

          {/* Spacer */}
          <div className="my-3 h-px bg-rm-border/60 mx-2" />
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col bg-rm-bg-primary relative overflow-hidden">
          {/* Close button */}
          <div className="absolute right-6 top-6 z-50 flex flex-col items-center gap-1 hidden md:flex">
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-rm-border text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text transition-all group"
            >
              <X size={18} />
            </button>
            <span className="text-[11px] font-bold text-rm-text-muted group-hover:text-rm-text-secondary">
              ESC
            </span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-[20px] md:px-[40px] py-[40px] md:py-[60px]">
            {activeTab === 'roles' ? (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <h2 id="server-settings-title" className="mb-6 text-xl font-bold text-rm-text">Roles</h2>
                <RoleManagement serverId={serverId} />
              </div>
            ) : activeTab === 'invites' ? (
              <InvitesTab serverId={serverId} serverName={serverName} />
            ) : activeTab === 'bans' ? (
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
                    {bans.map((ban) => (
                      <div key={ban.user_id} className="flex items-center gap-3 rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-3 transition-colors hover:border-rm-text-muted/20">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-sm font-bold text-destructive">
                          {(ban.username ?? '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-rm-text truncate">{ban.username ?? ban.user_id}</p>
                          {ban.reason && <p className="text-xs text-rm-text-muted truncate">Reason: {ban.reason}</p>}
                          <p className="text-[10px] text-rm-text-muted">Banned by {ban.banned_by_username ?? 'Unknown'} • {new Date(ban.created_at).toLocaleDateString()}</p>
                        </div>
                        <button
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
            ) : activeTab === 'audit' ? (
              <div className="w-full">
                <AuditLogTab serverId={serverId} />
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full">
                <h2 id="server-settings-title" className="mb-6 text-xl font-bold text-rm-text">
                  Server Overview
                </h2>

                {/* Overview */}
                <div className="space-y-8 max-w-xl">
                  {/* Icon upload */}
                  {isAdmin && (
                    <div className="space-y-3">
                      <label className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted block">Server Icon</label>
                      <div className="flex items-center gap-5">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-rm-border bg-rm-bg-surface transition-all hover:border-primary/50 hover:bg-rm-bg-elevated"
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
                            <button
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
                      {iconError && <p className="text-xs font-medium text-red-400">{iconError}</p>}
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
                    <button
                      onClick={handleSave}
                      disabled={saving || (!name.trim() && !iconFile && !removeIcon) || (name === serverName && !iconFile && !removeIcon)}
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

                    {/* Danger Zone */}
                    <div className="space-y-4 rounded-xl border border-destructive/20 bg-destructive/5 p-5">
                      <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-destructive">
                        <AlertTriangle className="h-4 w-4" />
                        Danger Zone
                      </h3>
                      <p className="text-sm text-rm-text-secondary mb-2">
                        Deleting a server is permanent and cannot be undone. All messages, roles, and channels will be lost.
                      </p>
                      {!confirmDelete ? (
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition-all hover:brightness-110"
                        >
                          Delete Server
                        </button>
                      ) : (
                        <div className="space-y-3 mt-4 bg-rm-bg-surface/50 p-4 rounded-xl border border-destructive/10">
                          <p className="text-sm text-rm-text-muted">
                            Type <strong className="text-rm-text font-bold select-all">{serverName}</strong> to confirm deletion:
                          </p>
                          <input
                            value={deleteText}
                            onChange={(e) => setDeleteText(e.target.value)}
                            placeholder="Server name"
                            className="w-full max-w-sm rounded-xl border border-destructive/20 bg-rm-bg-surface px-4 py-2.5 text-sm text-rm-text outline-none placeholder:text-rm-text-muted/40 focus:border-destructive/30 focus:ring-2 focus:ring-destructive/20"
                          />
                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={handleDelete}
                              disabled={deleteText !== serverName}
                              className="rounded-xl bg-destructive px-5 py-2 text-sm font-semibold text-destructive-foreground transition-all hover:brightness-110 disabled:opacity-40"
                            >
                              Delete Forever
                            </button>
                            <button
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
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
