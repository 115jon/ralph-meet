
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { getDisplayInitial, getDisplayName } from '@/lib/display-name';
import { getAuthAssetUrl, getWebOrigin } from "@/lib/platform";
import type { Invite } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat-store';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { Check, Copy, Hash, Link, Loader2, Plus, X } from './Icons';

interface InvitesTabProps {
  serverId: string;
  serverName: string;
}

/** Live countdown display: DD:HH:MM:SS */
function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, dispatch] = useReducer((_: string, next: string) => next, '');

  useEffect(() => {
    function update() {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        dispatch('Expired');
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      dispatch(
        days > 0
          ? `${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
          : `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      );
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <span className={cn(
      "font-mono text-[13px]",
      remaining === 'Expired' ? "text-destructive" : "text-rm-text-muted"
    )}>
      {remaining}
    </span>
  );
}



interface InvitesState {
  invites: Invite[];
  loading: boolean;
  isPaused: boolean;
  showCreate: boolean;
  creating: boolean;
  copied: string | null;
  createChannelId: string;
  createMaxAge: number;
  createMaxUses: number;
  createTemporary: boolean;
}

type InvitesAction =
  | { type: 'SET_INVITES'; payload: Invite[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_PAUSED'; payload: boolean }
  | { type: 'TOGGLE_SHOW_CREATE'; payload?: boolean }
  | { type: 'SET_CREATING'; payload: boolean }
  | { type: 'SET_COPIED'; payload: string | null }
  | { type: 'SET_CREATE_FIELD'; field: keyof InvitesState; value: any }
  | { type: 'UPDATE_INVITE_USES'; code: string; uses: number }
  | { type: 'REMOVE_INVITE'; code: string };

function invitesReducer(state: InvitesState, action: InvitesAction): InvitesState {
  switch (action.type) {
    case 'SET_INVITES':
      return { ...state, invites: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_PAUSED':
      return { ...state, isPaused: action.payload };
    case 'TOGGLE_SHOW_CREATE':
      return { ...state, showCreate: action.payload !== undefined ? action.payload : !state.showCreate };
    case 'SET_CREATING':
      return { ...state, creating: action.payload };
    case 'SET_COPIED':
      return { ...state, copied: action.payload };
    case 'SET_CREATE_FIELD':
      return { ...state, [action.field]: action.value };
    case 'UPDATE_INVITE_USES':
      return {
        ...state,
        invites: state.invites.map(inv => inv.code === action.code ? { ...inv, uses: action.uses } : inv)
      };
    case 'REMOVE_INVITE':
      return {
        ...state,
        invites: state.invites.filter(i => i.code !== action.code)
      };
    default:
      return state;
  }
}

const initialState: InvitesState = {
  invites: [],
  loading: true,
  isPaused: false,
  showCreate: false,
  creating: false,
  copied: null,
  createChannelId: '',
  createMaxAge: 604800,
  createMaxUses: 0,
  createTemporary: false,
};

export default function InvitesTab({ serverId, serverName }: InvitesTabProps) {
  const [state, dispatch] = useReducer(invitesReducer, initialState);

  const channels = useChatStore(s => s.channels);
  const members = useChatStore(s => s.members);
  const textChannels = channels.filter(c => c.channel_type === 'text');

  const togglePauseRef = useRef(false);

  const fetchInvites = useCallback(async () => {
    try {
      const data = await apiGet<Invite[]>(`/api/servers/${serverId}/invites`);
      dispatch({ type: 'SET_INVITES', payload: data });
    } catch (err) {
      console.error('Failed to fetch invites:', err);
    }
  }, [serverId]);

  const fetchServerPauseState = useCallback(async () => {
    try {
      const data = await apiGet<{ invites_paused?: number }>(`/api/servers/${serverId}/settings`);
      dispatch({ type: 'SET_PAUSED', payload: !!data.invites_paused });
    } catch {
      // Settings endpoint might not support GET — fallback to not paused
    }
  }, [serverId]);

  useEffect(() => {
    dispatch({ type: 'SET_LOADING', payload: true });
    Promise.all([fetchInvites(), fetchServerPauseState()]).finally(() => dispatch({ type: 'SET_LOADING', payload: false }));
  }, [fetchInvites, fetchServerPauseState]);

  // Listen for real-time invite usage updates
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.event === "INVITE_UPDATED" && detail.data.server_id === serverId) {
        dispatch({ type: 'UPDATE_INVITE_USES', code: detail.data.code, uses: detail.data.uses });
      }
    };
    window.addEventListener("chat-gateway-event", handler);
    return () => window.removeEventListener("chat-gateway-event", handler);
  }, [serverId]);

  const handleTogglePause = async () => {
    if (togglePauseRef.current) return;
    togglePauseRef.current = true;
    const newVal = !state.isPaused;
    dispatch({ type: 'SET_PAUSED', payload: newVal });
    try {
      const { apiPatch } = await import('@/lib/api-client');
      await apiPatch(`/api/servers/${serverId}/settings`, { invites_paused: newVal });
    } catch (err) {
      console.error('Failed to toggle pause:', err);
      dispatch({ type: 'SET_PAUSED', payload: !newVal });
    } finally {
      togglePauseRef.current = false;
    }
  };

  const handleCreate = async () => {
    if (state.creating) return;
    dispatch({ type: 'SET_CREATING', payload: true });
    try {
      const data = await apiPost<{ code: string; expires_at: string | null }>(`/api/servers/${serverId}/invites`, {
        channel_id: state.createChannelId || undefined,
        max_age: state.createMaxAge || undefined,
        max_uses: state.createMaxUses || undefined,
        temporary: state.createTemporary || undefined,
      });
      await fetchInvites();
      dispatch({ type: 'TOGGLE_SHOW_CREATE', payload: false });
      // Copy the new invite link
      const link = `${getWebOrigin()}/invite/${data.code}`;
      await navigator.clipboard.writeText(link);
      dispatch({ type: 'SET_COPIED', payload: data.code });
      setTimeout(() => dispatch({ type: 'SET_COPIED', payload: null }), 2000);
    } catch (err) {
      console.error('Failed to create invite:', err);
    } finally {
      dispatch({ type: 'SET_CREATING', payload: false });
    }
  };

  const handleRevoke = async (code: string) => {
    try {
      await apiDelete(`/api/servers/${serverId}/invites/${code}`);
      dispatch({ type: 'REMOVE_INVITE', code });
    } catch (err) {
      console.error('Failed to revoke invite:', err);
    }
  };

  const handleCopy = async (code: string) => {
    const link = `${getWebOrigin()}/invite/${code}`;
    await navigator.clipboard.writeText(link);
    dispatch({ type: 'SET_COPIED', payload: code });
    setTimeout(() => dispatch({ type: 'SET_COPIED', payload: null }), 2000);
  };

  const selectStyle = "w-full rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-2 text-sm text-rm-text outline-none transition-all focus:border-primary/30 focus:ring-2 focus:ring-primary/20";

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full">
      <h2 className="mb-6 text-xl font-bold text-rm-text">Invites</h2>

      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">
          Active Invite Links
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTogglePause}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-all",
              state.isPaused
                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                : "border-rm-border text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
            )}
          >
            {state.isPaused ? 'Resume Invites' : 'Pause Invites'}
          </button>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_SHOW_CREATE' })}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" />
            Create invite link
          </button>
        </div>
      </div>

      {/* Create invite form */}
      {state.showCreate && (
        <div className="mb-4 rounded-xl border border-rm-border bg-rm-bg-surface p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="inv-channel" className="text-[10px] font-bold uppercase tracking-widest text-rm-text-muted">Channel</label>
              <select id="inv-channel" value={state.createChannelId} onChange={e => dispatch({ type: 'SET_CREATE_FIELD', field: 'createChannelId', value: e.target.value })} className={selectStyle}>
                <option value="">Server default</option>
                {textChannels.map(ch => (
                  <option key={ch.id} value={ch.id}>#{ch.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="inv-expiry" className="text-[10px] font-bold uppercase tracking-widest text-rm-text-muted">Expire After</label>
              <select id="inv-expiry" value={state.createMaxAge} onChange={e => dispatch({ type: 'SET_CREATE_FIELD', field: 'createMaxAge', value: Number(e.target.value) })} className={selectStyle}>
                <option value={1800}>30 minutes</option>
                <option value={3600}>1 hour</option>
                <option value={21600}>6 hours</option>
                <option value={43200}>12 hours</option>
                <option value={86400}>1 day</option>
                <option value={604800}>7 days</option>
                <option value={0}>Never</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="inv-uses" className="text-[10px] font-bold uppercase tracking-widest text-rm-text-muted">Max Uses</label>
              <select id="inv-uses" value={state.createMaxUses} onChange={e => dispatch({ type: 'SET_CREATE_FIELD', field: 'createMaxUses', value: Number(e.target.value) })} className={selectStyle}>
                <option value={0}>No limit</option>
                <option value={1}>1 use</option>
                <option value={5}>5 uses</option>
                <option value={10}>10 uses</option>
                <option value={25}>25 uses</option>
                <option value={50}>50 uses</option>
                <option value={100}>100 uses</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="inv-temp" className="text-[10px] font-bold uppercase tracking-widest text-rm-text-muted">Temporary Membership</label>
              <select id="inv-temp" value={state.createTemporary ? '1' : '0'} onChange={e => dispatch({ type: 'SET_CREATE_FIELD', field: 'createTemporary', value: e.target.value === '1' })} className={selectStyle}>
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={state.creating}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-40"
            >
              {state.creating && <Loader2 className="h-3 w-3 animate-spin" />}
              {state.creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => dispatch({ type: 'TOGGLE_SHOW_CREATE', payload: false })}
              className="rounded-lg px-3 py-2 text-sm text-rm-text-muted hover:text-rm-text transition-colors outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Paused banner */}
      {state.isPaused && (
        <div className="mb-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-2.5 text-sm text-yellow-400">
          All invites are currently paused. No new members can join via invite links.
        </div>
      )}

      {/* Table */}
      {state.loading ? (
        <div className="flex items-center gap-2 text-rm-text-muted py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading invites…
        </div>
      ) : state.invites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Link className="h-10 w-10 mb-3 text-rm-text-muted/30" />
          <p className="text-sm text-rm-text-muted">No active invites</p>
          <p className="text-xs text-rm-text-muted/60 mt-1">Create an invite link to let others join {serverName}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-rm-border">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_120px_60px_110px_40px] gap-2 border-b border-rm-border bg-rm-bg-surface/50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">
            <span>Inviter</span>
            <span>Invite Code</span>
            <span>Uses</span>
            <span>Expires</span>
            <span />
          </div>

          {/* Rows */}
          {state.invites.map(invite => {
            const member = members.find(m => m.user.id === invite.inviter_id);
            const inviterDisplayName = getDisplayName(member?.user, 'Unknown');
            const inviterAvatar = member?.user.avatar_url ?? null;

            return (
              <div
                key={invite.code}
                className="grid grid-cols-[1fr_120px_60px_110px_40px] gap-2 items-center border-b border-rm-border/50 px-4 py-3 transition-colors hover:bg-rm-bg-hover/50 last:border-0"
              >
                {/* Inviter */}
                <div className="flex items-center gap-2.5 min-w-0">
                  {inviterAvatar ? (
                    <img src={getAuthAssetUrl(inviterAvatar)} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {getDisplayInitial(member?.user)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-rm-text truncate">
                      {inviterDisplayName}
                    </p>
                    {invite.channel_name && (
                      <p className="flex items-center gap-0.5 text-[11px] text-rm-text-muted truncate">
                        <Hash className="h-2.5 w-2.5" />{invite.channel_name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Code */}
                <button
                  onClick={() => handleCopy(invite.code)}
                  className="flex items-center gap-1 text-sm text-rm-text-muted hover:text-rm-text transition-colors group"
                >
                  <span className="font-mono">{invite.code}</span>
                  {state.copied === invite.code ? (
                    <Check className="h-3 w-3 text-primary" />
                  ) : (
                    <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                  )}
                </button>

                {/* Uses */}
                <span className="text-sm text-rm-text-muted">
                  {invite.uses}{invite.max_uses ? `/${invite.max_uses}` : ''}
                </span>

                {/* Expires */}
                {invite.expires_at ? (
                  <CountdownTimer expiresAt={invite.expires_at} />
                ) : (
                  <span className="text-[13px] text-rm-text-muted">Never</span>
                )}

                {/* Revoke */}
                <button
                  onClick={() => handleRevoke(invite.code)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-rm-text-muted hover:bg-destructive/10 hover:text-destructive transition-all"
                  title="Revoke invite"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  );
}
