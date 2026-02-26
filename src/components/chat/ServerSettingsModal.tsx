'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, X } from "./Icons";

interface ServerSettingsModalProps {
  serverId: string;
  serverName: string;
  iconUrl: string | null;
  userRole: number;
  onClose: () => void;
  onUpdated: (updates: { name?: string; icon_url?: string }) => void;
  onDeleted: () => void;
}

export default function ServerSettingsModal({
  serverId,
  serverName,
  userRole,
  onClose,
  onUpdated,
  onDeleted,
}: ServerSettingsModalProps) {
  const [name, setName] = useState(serverName);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');



  const isAdmin = userRole >= 2;
  const isOwner = userRole >= 3;

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
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }}
        role="button"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div
        className="relative z-10 w-full max-w-[460px] animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary p-6 shadow-2xl duration-200"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-settings-title"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-rm-text-muted/40 transition-colors hover:text-rm-text outline-none"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 id="server-settings-title" className="mb-6 text-lg font-bold text-rm-text">Server Settings</h2>

        {/* Overview */}
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">Overview</h3>
          <div className="space-y-2">
            <label htmlFor="server-name-setting" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">Server Name</label>
            <input
              id="server-name-setting"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              className="w-full rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-3 text-rm-text outline-none transition-all placeholder:text-rm-text-muted/40 focus:border-rm-text/20 focus:ring-2 focus:ring-rm-text/10 disabled:opacity-40"
            />
          </div>
          {isAdmin && (
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || name === serverName}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>

        {isOwner && (
          <>
            <div className="my-6 h-px bg-rm-border" />

            {/* Danger Zone */}
            <div className="space-y-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
              <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Danger Zone
              </h3>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition-all hover:brightness-110"
                >
                  Delete Server
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-rm-text-muted">
                    Type <strong className="text-rm-text">{serverName}</strong> to confirm deletion:
                  </p>
                  <input
                    value={deleteText}
                    onChange={(e) => setDeleteText(e.target.value)}
                    placeholder="Server name"
                    className="w-full rounded-xl border border-destructive/20 bg-rm-bg-surface px-4 py-2.5 text-sm text-rm-text outline-none placeholder:text-rm-text-muted/40 focus:border-destructive/30 focus:ring-2 focus:ring-destructive/20"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleteText !== serverName}
                      className="rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition-all hover:brightness-110 disabled:opacity-40"
                    >
                      Delete Forever
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDelete(false);
                        setDeleteText('');
                      }}
                      className="rounded-xl px-4 py-2.5 text-sm font-medium text-rm-text-muted hover:text-rm-text transition-colors outline-none"
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
    </div>,
    document.body
  );
}
