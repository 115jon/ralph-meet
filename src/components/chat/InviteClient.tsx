

import { apiGet, apiPost } from '@/lib/api-client';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check, Link2, Loader2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface InvitePreview {
  code: string;
  server: {
    id: string;
    name: string;
    icon_url: string | null;
    member_count: number;
  };
  inviter: {
    username: string;
    avatar_url: string | null;
  };
}

export default function InviteClient() {
  const { code } = useParams({ strict: false }) as { code: string };
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'preview' | 'joining' | 'success' | 'error'>('loading');
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch invite preview
  useEffect(() => {
    if (!code) return;
    fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const fetchPreview = async () => {
    setStatus('loading');
    try {
      const data = await apiGet<InvitePreview>(`/api/invites/${code}`);
      setInvite(data);
      setStatus('preview');
    } catch (err: any) {
      setErrorMsg(err.message || 'Invite not found');
      setStatus('error');
    }
  };

  const joinServer = useCallback(async () => {
    setStatus('joining');
    try {
      type JoinRes = { joined?: boolean; already_member?: boolean; server?: { name: string; id: string } };
      const data = await apiPost<JoinRes>(`/api/invites/${code}/join`, {});

      if (data.server) {
        setStatus('success');
        setTimeout(() => navigate({ to: '/chat' }), 1500);
      } else {
        setErrorMsg('Failed to join');
        setStatus('error');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error');
      setStatus('error');
    }
  }, [code, navigate]);

  return (
    <div className="flex h-full items-center justify-center bg-rm-bg-primary px-4 select-none">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute h-[500px] w-[500px] rounded-full bg-indigo-500/8 blur-[120px]"
          style={{ top: '15%', left: '25%' }}
        />
        <div
          className="absolute h-[400px] w-[400px] rounded-full bg-purple-500/6 blur-[100px]"
          style={{ bottom: '20%', right: '20%' }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[420px]">
        {/* Loading */}
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06] backdrop-blur-xl">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
            <p className="text-sm text-rm-text-muted">Loading invite...</p>
          </div>
        )}

        {/* Preview */}
        {status === 'preview' && invite && (
          <div className="flex flex-col items-center gap-6 rounded-2xl bg-rm-bg-secondary/80 p-8 shadow-2xl ring-1 ring-white/[0.06] backdrop-blur-xl">
            {/* Invite badge */}
            <div className="flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1 ring-1 ring-indigo-400/20">
              <Link2 className="h-3.5 w-3.5 text-indigo-400" />
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Invite</span>
            </div>

            <p className="text-sm text-rm-text-muted -mt-2">
              You've been invited to join a server
            </p>

            {/* Server card */}
            <div className="flex w-full items-center gap-4 rounded-xl bg-rm-bg-primary/60 p-4 ring-1 ring-white/[0.06]">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 ring-1 ring-white/10 overflow-hidden">
                {invite.server.icon_url ? (
                  <img
                    src={invite.server.icon_url}
                    alt={invite.server.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xl font-bold text-white/80">
                    {invite.server.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold text-rm-text">
                  {invite.server.name}
                </h2>
                <div className="flex items-center gap-1.5 text-sm text-rm-text-muted">
                  <Users className="h-3.5 w-3.5" />
                  <span>{invite.server.member_count.toLocaleString()} {invite.server.member_count === 1 ? 'member' : 'members'}</span>
                </div>
              </div>
            </div>

            {/* Inviter info */}
            <p className="text-xs text-rm-text-muted">
              Invited by <span className="font-semibold text-rm-text-secondary">{invite.inviter.username}</span>
            </p>

            {/* Accept Button */}
            <button
              onClick={joinServer}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:from-indigo-500 hover:to-purple-500 hover:shadow-indigo-500/30 active:scale-[0.98]"
            >
              Accept Invite
            </button>

            {/* Decline link */}
            <button
              onClick={() => navigate({ to: '/chat' })}
              className="text-xs text-rm-text-muted hover:text-rm-text-secondary transition-colors"
            >
              No thanks
            </button>
          </div>
        )}

        {/* Joining */}
        {status === 'joining' && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06] backdrop-blur-xl">
            <div className="relative">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
            </div>
            <p className="text-sm font-medium text-rm-text">Joining {invite?.server.name}...</p>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06] backdrop-blur-xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/30">
              <Check className="h-7 w-7 text-emerald-400" />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-bold text-rm-text">
                Joined {invite?.server.name}!
              </h2>
              <p className="mt-1 text-sm text-rm-text-muted">Redirecting to chat...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-5 rounded-2xl bg-rm-bg-secondary/80 p-10 shadow-2xl ring-1 ring-white/[0.06] backdrop-blur-xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-400/30">
              <X className="h-7 w-7 text-red-400" />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-bold text-rm-text">Invite Invalid</h2>
              <p className="mt-1 text-sm text-rm-text-muted">{errorMsg}</p>
            </div>
            <button
              onClick={() => navigate({ to: '/chat' })}
              className="rounded-xl bg-rm-bg-hover px-6 py-2.5 text-sm font-medium text-rm-text ring-1 ring-white/[0.06] transition-colors hover:bg-rm-bg-elevated"
            >
              Go to Chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
