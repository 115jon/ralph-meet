
import { apiPost } from '@/lib/api-client';
import type { Channel, Relationship } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useChatState } from '@/stores/chat-store';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Hash, Loader2, Search, X } from './Icons';

interface ChannelInviteModalProps {
  serverId: string;
  serverName: string;
  channel: Channel;
  onClose: () => void;
}

export default function ChannelInviteModal({
  serverId,
  serverName,
  channel,
  onClose,
}: ChannelInviteModalProps) {
  const { relationships } = useChatState();
  const [search, setSearch] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState<Set<string>>(new Set());

  // Filter to accepted friends only (type 0)
  const friends = useMemo(
    () => relationships.filter((r: Relationship) => r.type === 0),
    [relationships]
  );

  const filteredFriends = useMemo(() => {
    if (!search.trim()) return friends;
    const q = search.toLowerCase();
    return friends.filter((r: Relationship) =>
      r.user.username.toLowerCase().includes(q)
    );
  }, [friends, search]);

  // Auto-create a channel-scoped invite on open
  useEffect(() => {
    let cancelled = false;
    async function createInvite() {
      try {
        const data = await apiPost<{ code: string }>(`/api/servers/${serverId}/invites`, {
          channel_id: channel.id,
          max_age: 604800, // 7 days
        });
        if (!cancelled) setInviteCode(data.code);
      } catch (err) {
        console.error('Failed to create invite:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    createInvite();
    return () => { cancelled = true; };
  }, [serverId, channel.id]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const copyLink = async () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/invite/${inviteCode}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInviteUser = (userId: string) => {
    // Mark as invited visually — in a full implementation this would send a DM
    setInvitedUsers(prev => new Set(prev).add(userId));
  };

  const inviteUrl = inviteCode ? `${window.location.origin}/invite/${inviteCode}` : '';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        role="button"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-[480px] animate-in fade-in zoom-in-95 rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl duration-200 overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-6 pt-5 pb-3">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1 text-rm-text-muted/40 transition-colors hover:text-rm-text outline-none"
          >
            <X className="h-5 w-5" />
          </button>

          <h2 className="text-base font-bold text-rm-text">
            Invite friends to <span className="text-primary">{serverName}</span>
          </h2>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-rm-text-muted">
            Recipients will land in <Hash className="h-3 w-3" />{channel.name}
          </p>
        </div>

        {/* Search */}
        <div className="px-6 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rm-text-muted/40" />
            <input
              type="text"
              placeholder="Search for friends"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border border-rm-border bg-rm-bg-surface py-2 pl-9 pr-3 text-sm text-rm-text outline-none placeholder:text-rm-text-muted/40 focus:border-primary/30 focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
        </div>

        {/* Friends list */}
        <div className="flex-1 overflow-y-auto px-3 custom-scrollbar min-h-0">
          {friends.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-rm-text-muted">
              No friends to invite. Add some friends first!
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-rm-text-muted">
              No friends matching &quot;{search}&quot;
            </div>
          ) : (
            filteredFriends.map((rel: Relationship) => {
              const isInvited = invitedUsers.has(rel.user.id);
              return (
                <div
                  key={rel.user.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-rm-bg-hover"
                >
                  {/* Avatar */}
                  {rel.user.avatar_url ? (
                    <img src={rel.user.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {rel.user.username[0].toUpperCase()}
                    </div>
                  )}

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-rm-text truncate">{rel.user.username}</p>
                  </div>

                  {/* Invite button */}
                  <button
                    onClick={() => handleInviteUser(rel.user.id)}
                    disabled={isInvited}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                      isInvited
                        ? "bg-rm-bg-surface text-rm-text-muted border border-rm-border cursor-default"
                        : "bg-primary text-primary-foreground hover:brightness-110"
                    )}
                  >
                    {isInvited ? 'Invited' : 'Invite'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom: invite link */}
        <div className="border-t border-rm-border px-6 py-4">
          <p className="mb-2 text-xs font-medium text-rm-text-muted">
            Or, send a server invite link to a friend
          </p>
          <div className="flex gap-2">
            <input
              value={loading ? 'Generating...' : inviteUrl}
              readOnly
              onClick={e => (e.target as HTMLInputElement).select()}
              className="flex-1 rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-2 text-sm text-rm-text outline-none truncate"
            />
            <button
              onClick={copyLink}
              disabled={loading || !inviteCode}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                copied
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-primary text-primary-foreground hover:brightness-110"
              )}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : copied ? (
                <><Check className="h-3.5 w-3.5" /> Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copy</>
              )}
            </button>
          </div>
          {inviteCode && (
            <p className="mt-2 text-[11px] text-rm-text-muted/60">
              Your invite link expires in 7 days.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
