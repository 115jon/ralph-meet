
import { apiDelete, apiGet, apiPut } from '@/lib/api-client';
import { PERMISSIONS } from '@/lib/permissions';
import type { Role } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Check, Loader2, Plus, Slash, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Override {
  id?: string;
  target_id: string;
  target_type: 'role' | 'user';
  allow: number;
  deny: number;
  name?: string; // added manually for display
  color?: string | null; // added manually for display
  avatar_url?: string | null; // added manually for display
}

interface ChannelPermissionsTabProps {
  serverId: string;
  channelId: string;
  isVoice: boolean;
}

const TEXT_PERMISSIONS = [
  { mask: PERMISSIONS.VIEW_CHANNELS, name: 'View Channel', desc: 'Allows members to view and read messages in this channel' },
  { mask: PERMISSIONS.MANAGE_CHANNELS, name: 'Manage Channel', desc: 'Allows members to change the channels name or delete it' },
  { mask: PERMISSIONS.MANAGE_MESSAGES, name: 'Manage Messages', desc: 'Allows members to delete messages by other users or pin any message' },
  { mask: PERMISSIONS.SEND_MESSAGES, name: 'Send Messages', desc: 'Allows members to send text messages' },
  { mask: PERMISSIONS.ADD_REACTIONS, name: 'Add Reactions', desc: 'Allows members to add new emoji reactions to a message' },
  { mask: PERMISSIONS.ATTACH_FILES, name: 'Attach Files', desc: 'Allows members to upload files' },
];

const VOICE_PERMISSIONS = [
  { mask: PERMISSIONS.VIEW_CHANNELS, name: 'View Channel', desc: 'Allows members to see the voice channel' },
  { mask: PERMISSIONS.MANAGE_CHANNELS, name: 'Manage Channel', desc: 'Allows members to change the channels name or delete it' },
  { mask: PERMISSIONS.CONNECT, name: 'Connect', desc: 'Allows members to join this voice channel' },
  { mask: PERMISSIONS.SPEAK, name: 'Speak', desc: 'Allows members to talk in this voice channel' },
  { mask: PERMISSIONS.VIDEO, name: 'Video', desc: 'Allows members to share their screen or camera' },
  { mask: PERMISSIONS.MUTE_MEMBERS, name: 'Mute Members', desc: 'Allows members to mute other users in this voice channel' },
];

export default function ChannelPermissionsTab({ serverId, channelId, isVoice }: ChannelPermissionsTabProps) {
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<any[]>([]);

  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [isAddingTarget, setIsAddingTarget] = useState(false);
  const [savingTarget, setSavingTarget] = useState<string | null>(null);

  const permissionList = isVoice ? VOICE_PERMISSIONS : TEXT_PERMISSIONS;

  const fetchData = async () => {
    try {
      setLoading(true);
      const [overridesData, rolesData, membersData] = await Promise.all([
        apiGet<Override[]>(`/api/channels/${channelId}/permissions`),
        apiGet<Role[]>(`/api/servers/${serverId}/roles`),
        apiGet<any[]>(`/api/servers/${serverId}/members`)
      ]);

      setRoles(rolesData);
      setMembers(membersData);

      // Enhance overrides with names/colors
      const enhancedOverrides = overridesData.map(o => {
        if (o.target_type === 'role') {
          const role = rolesData.find(r => r.id === o.target_id);
          return { ...o, name: role?.name || 'Unknown Role', color: role?.color };
        } else {
          const member = membersData.find(m => m.user_id === o.target_id);
          return { ...o, name: member?.user?.username || 'Unknown User', avatar_url: member?.user?.avatar_url };
        }
      });

      // Ensure @everyone override exists in the list for editing at the top, even if empty
      const everyoneRole = rolesData.find(r => r.is_default);
      if (everyoneRole && !enhancedOverrides.find(o => o.target_id === everyoneRole.id)) {
        enhancedOverrides.unshift({
          target_id: everyoneRole.id,
          target_type: 'role',
          allow: 0,
          deny: 0,
          name: '@everyone',
          color: everyoneRole.color
        });
      }

      setOverrides(enhancedOverrides);
      if (enhancedOverrides.length > 0 && !selectedTargetId) {
        setSelectedTargetId(everyoneRole?.id || enhancedOverrides[0].target_id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [channelId]);

  const selectedOverride = overrides.find(o => o.target_id === selectedTargetId);

  const handleUpdatePermission = async (mask: number, state: 'allow' | 'deny' | 'inherit') => {
    if (!selectedOverride) return;

    setSavingTarget(selectedOverride.target_id);

    let newAllow = selectedOverride.allow;
    let newDeny = selectedOverride.deny;

    if (state === 'allow') {
      newAllow |= mask;
      newDeny &= ~mask;
    } else if (state === 'deny') {
      newDeny |= mask;
      newAllow &= ~mask;
    } else {
      newAllow &= ~mask;
      newDeny &= ~mask;
    }

    try {
      await apiPut(`/api/channels/${channelId}/permissions/${selectedOverride.target_id}`, {
        target_type: selectedOverride.target_type,
        allow: newAllow,
        deny: newDeny
      });

      setOverrides(prev => prev.map(o => o.target_id === selectedOverride.target_id ? { ...o, allow: newAllow, deny: newDeny } : o));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTarget(null);
    }
  };

  const handleDeleteOverride = async (targetId: string) => {
    if (!confirm('Are you sure you want to remove permissions for this target?')) return;

    setSavingTarget(targetId);
    try {
      await apiDelete(`/api/channels/${channelId}/permissions/${targetId}`);
      setOverrides(prev => prev.filter(o => o.target_id !== targetId));
      if (selectedTargetId === targetId) {
        setSelectedTargetId(overrides[0]?.target_id || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTarget(null);
    }
  };

  const handleAddOverride = (target_id: string, target_type: 'role' | 'user', name: string, color?: string | null, avatar_url?: string | null) => {
    if (overrides.some(o => o.target_id === target_id)) {
      setSelectedTargetId(target_id);
      setIsAddingTarget(false);
      return;
    }

    const newOverride: Override = {
      target_id,
      target_type,
      allow: 0,
      deny: 0,
      name,
      color,
      avatar_url
    };

    setOverrides([...overrides, newOverride]);
    setSelectedTargetId(target_id);
    setIsAddingTarget(false);
  };

  const availableRoles = roles.filter(r => !r.is_default && !overrides.some(o => o.target_id === r.id));
  const availableMembers = members.filter(m => !overrides.some(o => o.target_id === m.user.id));

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-rm-text-muted" /></div>;
  }

  return (
    <div className="flex max-h-[500px] h-[500px] border border-rm-border rounded-xl overflow-hidden bg-rm-bg-surface">
      {/* Target Sidebar */}
      <div className="w-56 bg-rm-bg-secondary border-r border-rm-border flex flex-col relative z-10">
        <div className="p-3 border-b border-rm-border flex justify-between items-center">
          <span className="text-xs font-bold uppercase tracking-widest text-rm-text-muted">Roles/Members</span>
          <button onClick={() => setIsAddingTarget(!isAddingTarget)} className="p-1 hover:bg-rm-bg-hover rounded transition-colors text-rm-text-secondary hover:text-rm-text relative z-10">
            {isAddingTarget ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>

        {isAddingTarget ? (
          <div className="flex-1 overflow-y-auto p-2 bg-rm-bg-surface space-y-4">
            {availableRoles.length > 0 && (
              <div>
                <span className="px-2 text-[10px] font-bold uppercase text-rm-text-muted">Roles</span>
                <div className="space-y-1 mt-1">
                  {availableRoles.map(role => (
                    <button
                      key={role.id}
                      onClick={() => handleAddOverride(role.id, 'role', role.name, role.color || undefined)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-rm-bg-hover text-sm text-left"
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color || '#94a3b8' }} />
                      <span className="truncate">{role.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {availableMembers.length > 0 && (
              <div>
                <span className="px-2 text-[10px] font-bold uppercase text-rm-text-muted">Members</span>
                <div className="space-y-1 mt-1">
                  {availableMembers.map(m => (
                    <button
                      key={m.user.id}
                      onClick={() => handleAddOverride(m.user.id, 'user', m.user.username, undefined, m.user.avatar_url)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-rm-bg-hover text-sm text-left"
                    >
                      <div className="w-5 h-5 rounded-full bg-rm-bg-elevated overflow-hidden flex items-center justify-center shrink-0">
                        {m.user.avatar_url ? (
                          <img src={m.user.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] text-rm-text uppercase font-bold">{m.user.username[0]}</span>
                        )}
                      </div>
                      <span className="truncate">{m.user.username}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {availableRoles.length === 0 && availableMembers.length === 0 && (
              <p className="p-2 text-xs text-rm-text-muted text-center">Everyone is added.</p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {overrides.map(o => {
              const roleInfo = roles.find(r => r.id === o.target_id);
              const isDefault = roleInfo?.is_default;

              return (
                <button
                  key={o.target_id}
                  onClick={() => setSelectedTargetId(o.target_id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors group",
                    selectedTargetId === o.target_id ? "bg-primary/20 text-primary" : "hover:bg-rm-bg-hover text-rm-text"
                  )}
                >
                  {o.target_type === 'role' ? (
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: o.color || '#94a3b8' }} />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-rm-bg-elevated overflow-hidden flex items-center justify-center -ml-1 shrink-0">
                      {o.avatar_url ? (
                        <img src={o.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-rm-text uppercase font-bold">{(o.name || '?')[0]}</span>
                      )}
                    </div>
                  )}
                  <span className="truncate flex-1">{o.name}</span>
                  {!isDefault && (
                    <Trash2
                      className="h-3 w-3 opacity-0 group-hover:opacity-100 hover:text-destructive shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleDeleteOverride(o.target_id); }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Editor Main Area */}
      <div className="flex-1 flex flex-col bg-rm-bg-primary overflow-hidden relative">
        {selectedOverride ? (
          <>
            <div className="p-5 border-b border-rm-border flex items-center gap-3">
              <span className="font-bold text-lg text-rm-text flex items-center gap-2">
                {selectedOverride.target_type === 'role' ? (
                  <div className="w-4 h-4 rounded-full inline-block" style={{ backgroundColor: selectedOverride.color || '#94a3b8' }} />
                ) : null}
                {selectedOverride.name}
              </span>
              {savingTarget === selectedOverride.target_id && <Loader2 className="h-4 w-4 animate-spin text-rm-text-muted" />}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 relative z-0">
              {permissionList.map(perm => {
                const isAllowed = ((selectedOverride.allow & perm.mask) === perm.mask);
                const isDenied = ((selectedOverride.deny & perm.mask) === perm.mask);
                const isInherit = !isAllowed && !isDenied;

                return (
                  <div key={perm.mask} className="flex items-center justify-between pb-4 border-b border-rm-border/30 last:border-0 hover:bg-rm-white/5 rounded px-2 -mx-2 transition-colors">
                    <div className="max-w-[70%]">
                      <div className="text-sm font-semibold text-rm-text">{perm.name}</div>
                      <div className="text-xs text-rm-text-secondary mt-1">{perm.desc}</div>
                    </div>

                    {/* Tri-state toggle UI */}
                    <div className="flex bg-rm-bg-elevated rounded-lg p-1 gap-1 border border-rm-border/50 shadow-inner">
                      <button
                        onClick={() => handleUpdatePermission(perm.mask, 'deny')}
                        className={cn(
                          "w-10 h-8 rounded flex items-center justify-center transition-colors shadow-sm",
                          isDenied ? "bg-red-500 text-white" : "hover:bg-rm-white/10 text-rm-text-muted"
                        )}
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleUpdatePermission(perm.mask, 'inherit')}
                        className={cn(
                          "w-10 h-8 rounded flex items-center justify-center transition-colors shadow-sm",
                          isInherit ? "bg-slate-500 text-white border border-rm-border" : "hover:bg-rm-white/10 text-rm-text-muted"
                        )}
                      >
                        <Slash className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleUpdatePermission(perm.mask, 'allow')}
                        className={cn(
                          "w-10 h-8 rounded flex items-center justify-center transition-colors shadow-sm",
                          isAllowed ? "bg-green-500 text-white" : "hover:bg-rm-white/10 text-rm-text-muted"
                        )}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-rm-text-muted">
            Select a role or member to edit overrides
          </div>
        )}
      </div>
    </div>
  );
}
