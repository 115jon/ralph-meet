
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Loader2, X } from "./Icons";

interface InviteModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export default function InviteModal({ serverId, serverName, onClose }: InviteModalProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expiresHours, setExpiresHours] = useState(24);
  const [maxUses, setMaxUses] = useState(0);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const createInvite = async () => {
    setLoading(true);
    try {
      const data = await apiPost<{ code: string }>(`/api/servers/${serverId}/invites`, {
        expires_hours: expiresHours || null,
        max_uses: maxUses || null,
      });
      setInviteCode(data.code);
    } catch (err: any) {
      console.error("Failed to create invite:", err);
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    const link = `${window.location.origin}/invite/${inviteCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectStyle = "w-full rounded-xl border border-rm-border bg-rm-bg-surface px-3 py-2.5 text-sm text-rm-text outline-none transition-all focus:border-primary/30 focus:ring-2 focus:ring-primary/20";

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

      <div className="relative z-10 w-full max-w-[440px] animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary p-6 shadow-2xl duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-rm-text-muted/40 transition-colors hover:text-rm-text outline-none"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="mb-6 text-base font-semibold text-rm-text">
          Invite people to <span className="text-primary">{serverName}</span>
        </h2>

        {!inviteCode ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="expire-after" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40">Expire after</label>
              <select id="expire-after" value={expiresHours} onChange={(e) => setExpiresHours(Number(e.target.value))} className={selectStyle}>
                <option value={1}>1 hour</option>
                <option value={6}>6 hours</option>
                <option value={24}>24 hours</option>
                <option value={168}>7 days</option>
                <option value={0}>Never</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="max-uses" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted/40">Max uses</label>
              <select id="max-uses" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className={selectStyle}>
                <option value={0}>No limit</option>
                <option value={1}>1 use</option>
                <option value={5}>5 uses</option>
                <option value={10}>10 uses</option>
                <option value={25}>25 uses</option>
                <option value={100}>100 uses</option>
              </select>
            </div>
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-40"
              onClick={createInvite}
              disabled={loading}
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? 'Creating...' : 'Generate Invite Link'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${inviteCode}`}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 rounded-xl border border-rm-border bg-rm-bg-surface px-3 py-2.5 text-sm text-rm-text outline-none"
              />
              <button
                onClick={copyLink}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                  copied
                    ? "border-primary/30 bg-primary/20 text-primary"
                    : "border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
                )}
              >
                {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </button>
            </div>
            <p className="text-xs text-rm-text-muted">
              Share this link with others to let them join your server.
            </p>
            <button
              onClick={() => setInviteCode('')}
              className="text-xs font-medium text-rm-text-muted/60 transition-colors hover:text-rm-text outline-none"
            >
              Generate New Link
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
