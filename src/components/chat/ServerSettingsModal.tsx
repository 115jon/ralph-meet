'use client';

import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, Settings2, Shield, Trash2, X } from "./Icons";
import RoleManagement from './RoleManagement';

interface ServerSettingsModalProps {
  serverId: string;
  serverName: string;
  iconUrl: string | null;
  userPermissions: number;
  onClose: () => void;
  onUpdated: (updates: { name?: string; icon_url?: string }) => void;
  onDeleted: () => void;
}

export default function ServerSettingsModal({
  serverId,
  serverName,
  userPermissions,
  onClose,
  onUpdated,
  onDeleted,
}: ServerSettingsModalProps) {
  const [name, setName] = useState(serverName);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'bans'>('overview');

  const isAdmin = hasPermission(userPermissions, PERMISSIONS.MANAGE_SERVER) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const isOwner = hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const canManageRoles = hasPermission(userPermissions, PERMISSIONS.MANAGE_ROLES) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);
  const canBan = hasPermission(userPermissions, PERMISSIONS.BAN_MEMBERS) || hasPermission(userPermissions, PERMISSIONS.ADMINISTRATOR);

  // Bans state
  const [bans, setBans] = useState<Array<{ server_id: string; user_id: string; username?: string; avatar_url?: string; reason?: string; banned_by_username?: string; created_at: string }>>([]);
  const [bansLoading, setBansLoading] = useState(false);

  const fetchBans = useCallback(async () => {
    if (!canBan) return;
    setBansLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/bans`);
      if (res.ok) {
        setBans(await res.json());
      }
    } finally {
      setBansLoading(false);
    }
  }, [canBan, serverId]);

  const handleUnban = async (userId: string) => {
    const res = await fetch(`/api/servers/${serverId}/bans`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (res.ok) {
      setBans((prev) => prev.filter((b) => b.user_id !== userId));
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = async () => {
    if (!name.trim() || name === serverName) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        onUpdated({ name: name.trim() });
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteText !== serverName) return;
    const res = await fetch(`/api/servers/${serverId}/settings`, {
      method: 'DELETE',
    });
    if (res.ok) {
      onDeleted();
      onClose();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center p-0 md:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="relative flex w-full h-full md:max-h-[820px] md:max-w-[1040px] md:rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary border border-rm-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-[218px] flex flex-col shrink-0 bg-rm-server-bar pt-[40px] md:pt-[60px] pb-5 px-4 overflow-y-auto overflow-x-hidden custom-scrollbar border-r border-rm-border/50">
          <div className="mb-2 px-2">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted truncate block w-[180px]" title={serverName}>
              {serverName}
            </h2>
          </div>
          <button
            onClick={() => setActiveTab('overview')}
            className={cn(
              "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mb-1",
              activeTab === 'overview' ? "bg-primary/10 text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text"
            )}
          >
            <Settings2 className="h-4 w-4" /> Overview
          </button>

          {canManageRoles && (
            <button
              onClick={() => setActiveTab('roles')}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mb-1",
                activeTab === 'roles' ? "bg-primary/10 text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text"
              )}
            >
              <Shield className="h-4 w-4" /> Roles
            </button>
          )}

          {canBan && (
            <button
              onClick={() => { setActiveTab('bans'); fetchBans(); }}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mb-1",
                activeTab === 'bans' ? "bg-primary/10 text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text"
              )}
            >
              <AlertTriangle className="h-4 w-4" /> Bans
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
            ) : (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full">
                <h2 id="server-settings-title" className="mb-6 text-xl font-bold text-rm-text">
                  Server Overview
                </h2>

                {/* Overview */}
                <div className="space-y-4 max-w-xl">
                  <div className="space-y-2">
                    <label htmlFor="server-name-setting" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">Server Name</label>
                    <input
                      id="server-name-setting"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={!isAdmin}
                      className="w-full max-w-sm rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-3 text-rm-text outline-none transition-all placeholder:text-rm-text-muted/40 focus:border-rm-text/20 focus:ring-2 focus:ring-rm-text/10 disabled:opacity-40"
                    />
                  </div>
                  {isAdmin && (
                    <button
                      onClick={handleSave}
                      disabled={saving || !name.trim() || name === serverName}
                      className="mt-4 flex max-w-fit items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
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
