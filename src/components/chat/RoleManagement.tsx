import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { PERMISSIONS } from '@/lib/permissions';
import type { Role } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useEffect, useReducer } from 'react';
import { Loader2, Plus, Settings2, Shield, Trash2 } from './Icons';

interface RoleManagementProps {
  serverId: string;
}

interface State {
  roles: Role[];
  loading: boolean;
  error: string | null;
  selectedRole: Role | null;
  editState: {
    name: string;
    color: string;
    permissions: number;
    saving: boolean;
    isCreating: boolean;
  };
}

type Action =
  | { type: 'SET_ROLES'; payload: Role[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SELECT_ROLE'; payload: Role | null }
  | { type: 'SET_EDIT_STATE'; payload: Partial<State['editState']> }
  | { type: 'TOGGLE_PERMISSION'; payload: number }
  | { type: 'START_CREATE' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_ROLES':
      return { ...state, roles: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SELECT_ROLE':
      return {
        ...state,
        selectedRole: action.payload,
        editState: action.payload
          ? {
            ...state.editState,
            name: action.payload.name,
            color: action.payload.color || '',
            permissions: action.payload.permissions,
            isCreating: false,
          }
          : state.editState,
      };
    case 'SET_EDIT_STATE':
      return { ...state, editState: { ...state.editState, ...action.payload } };
    case 'TOGGLE_PERMISSION': {
      const current = state.editState.permissions;
      const mask = action.payload;
      const newPermissions = (current & mask) === mask ? current & ~mask : current | mask;
      return { ...state, editState: { ...state.editState, permissions: newPermissions } };
    }
    case 'START_CREATE':
      return {
        ...state,
        selectedRole: null,
        editState: {
          name: 'New Role',
          color: '#99aab5',
          permissions: 0,
          saving: false,
          isCreating: true,
        },
      };
    default:
      return state;
  }
}

export default function RoleManagement({ serverId }: RoleManagementProps) {
  const [state, dispatch] = useReducer(reducer, {
    roles: [],
    loading: true,
    error: null,
    selectedRole: null,
    editState: {
      name: '',
      color: '',
      permissions: 0,
      saving: false,
      isCreating: false,
    },
  });

  const fetchRoles = async () => {
    try {
      const data = await apiGet<Role[]>(`/api/servers/${serverId}/roles`);
      dispatch({ type: 'SET_ROLES', payload: data });
      if (data.length > 0) {
        if (!state.selectedRole) {
          dispatch({ type: 'SELECT_ROLE', payload: data.find((r: Role) => r.is_default) || data[0] });
        }
      }
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'An error occurred' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  useEffect(() => {
    fetchRoles();
  }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectRole = (role: Role | null) => {
    dispatch({ type: 'SELECT_ROLE', payload: role });
  };

  const handleSave = async () => {
    if (!state.editState.name.trim()) return;
    dispatch({ type: 'SET_EDIT_STATE', payload: { saving: true } });
    try {
      const url = state.editState.isCreating
        ? `/api/servers/${serverId}/roles`
        : `/api/servers/${serverId}/roles/${state.selectedRole!.id}`;

      const body = {
        name: state.editState.name.trim(),
        color: state.editState.color.trim() || null,
        permissions: state.editState.permissions
      };

      if (state.editState.isCreating) {
        await apiPost(url, body);
      } else {
        await apiPatch(url, body);
      }

      await fetchRoles();
      dispatch({ type: 'SET_EDIT_STATE', payload: { isCreating: false } });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to save role' });
    } finally {
      dispatch({ type: 'SET_EDIT_STATE', payload: { saving: false } });
    }
  };

  const handleDelete = async (roleId: string) => {
    if (!confirm('Are you sure you want to delete this role?')) return;
    dispatch({ type: 'SET_EDIT_STATE', payload: { saving: true } });
    try {
      await apiDelete(`/api/servers/${serverId}/roles/${roleId}`);
      if (state.selectedRole?.id === roleId) {
        dispatch({ type: 'SELECT_ROLE', payload: state.roles.find(r => r.id !== roleId) || null });
      }
      await fetchRoles();
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to delete role' });
    } finally {
      dispatch({ type: 'SET_EDIT_STATE', payload: { saving: false } });
    }
  };

  const startCreate = () => {
    dispatch({ type: 'START_CREATE' });
  };

  const togglePermission = (mask: number) => {
    dispatch({ type: 'TOGGLE_PERMISSION', payload: mask });
  };

  const PERMISSION_LIST = [
    { mask: PERMISSIONS.ADMINISTRATOR, name: 'Administrator', desc: 'Grants all permissions and bypasses bounds' },
    { mask: PERMISSIONS.MANAGE_SERVER, name: 'Manage Server', desc: 'Edit server settings' },
    { mask: PERMISSIONS.MANAGE_ROLES, name: 'Manage Roles', desc: 'Create and edit roles' },
    { mask: PERMISSIONS.MANAGE_CATEGORIES, name: 'Manage Categories', desc: 'Create and edit categories' },
    { mask: PERMISSIONS.MANAGE_CHANNELS, name: 'Manage Channels', desc: 'Create and edit channels' },
    { mask: PERMISSIONS.KICK_MEMBERS, name: 'Kick Members', desc: 'Remove members from server' },
    { mask: PERMISSIONS.BAN_MEMBERS, name: 'Ban Members', desc: 'Permanently remove members' },
    { mask: PERMISSIONS.CREATE_INVITE, name: 'Create Invite', desc: 'Invite new members' },
    { mask: PERMISSIONS.MANAGE_MESSAGES, name: 'Manage Messages', desc: 'Delete or pin others messages' },
    { mask: PERMISSIONS.SEND_MESSAGES, name: 'Send Messages', desc: 'Send text messages' },
  ];

  if (state.loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-rm-text-muted" /></div>;
  }

  return (
    <div className="flex h-[500px] border border-rm-border rounded-xl overflow-hidden bg-rm-bg-surface">
      {/* Role List Sidebar */}
      <div className="w-48 bg-rm-bg-secondary border-r border-rm-border flex flex-col">
        <div className="p-3 border-b border-rm-border flex justify-between items-center">
          <span className="text-xs font-bold uppercase tracking-widest text-rm-text-muted">Roles</span>
          <button onClick={startCreate} className="p-1 hover:bg-rm-bg-hover rounded transition-colors text-rm-text-secondary hover:text-rm-text">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-2 space-y-1">
          {state.roles.map(role => (
            <button
              key={role.id}
              onClick={() => selectRole(role)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
                state.selectedRole?.id === role.id && !state.editState.isCreating ? "bg-primary/20 text-primary" : "hover:bg-rm-bg-hover text-rm-text"
              )}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: role.color || '#94a3b8' }}
              />
              <span className="truncate">{role.name}</span>
            </button>
          ))}
          {state.editState.isCreating && (
            <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left bg-primary/20 text-primary">
              <div className="w-3 h-3 rounded-full shrink-0 bg-[#99aab5]" />
              <span className="truncate italic">New Role</span>
            </div>
          )}
        </div>
      </div>

      {/* Role Editor */}
      <div className="flex-1 flex flex-col bg-rm-bg-primary overflow-hidden">
        {(state.selectedRole || state.editState.isCreating) ? (
          <>
            <div className="p-4 border-b border-rm-border flex justify-between items-center">
              <h3 className="font-bold text-rm-text flex items-center gap-2">
                <Shield className="h-4 w-4" /> Edit Role
                {state.selectedRole?.is_default && <span className="text-[10px] bg-rm-bg-elevated px-1.5 py-0.5 rounded uppercase tracking-widest text-rm-text-muted">Default</span>}
              </h3>
              <div className="flex gap-2">
                {(!state.selectedRole?.is_default && !state.editState.isCreating) && (
                  <button
                    onClick={() => handleDelete(state.selectedRole!.id)}
                    className="p-1.5 text-rm-text-muted hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={state.editState.saving || !state.editState.name.trim()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {state.editState.saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {state.error && (
                <div className="bg-destructive/10 text-destructive text-xs p-3 rounded">{state.error}</div>
              )}

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="role-name" className="text-xs font-bold uppercase tracking-widest text-rm-text-muted">Role Name</label>
                  <input
                    id="role-name"
                    value={state.editState.name}
                    onChange={e => dispatch({ type: 'SET_EDIT_STATE', payload: { name: e.target.value } })}
                    disabled={state.selectedRole?.is_default}
                    className="w-full rounded bg-rm-bg-surface border border-rm-border px-3 py-2 text-sm text-rm-text outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="role-color" className="text-xs font-bold uppercase tracking-widest text-rm-text-muted">Role Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      id="role-color"
                      type="color"
                      value={state.editState.color || '#94a3b8'}
                      onChange={e => dispatch({ type: 'SET_EDIT_STATE', payload: { color: e.target.value } })}
                      disabled={state.selectedRole?.is_default}
                      className="h-8 w-8 rounded cursor-pointer disabled:opacity-50 border-0 p-0 bg-transparent"
                    />
                    <input
                      value={state.editState.color}
                      onChange={e => dispatch({ type: 'SET_EDIT_STATE', payload: { color: e.target.value } })}
                      placeholder="#000000"
                      disabled={state.selectedRole?.is_default}
                      className="w-32 rounded bg-rm-bg-surface border border-rm-border px-3 py-1.5 text-sm text-rm-text outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 disabled:opacity-50 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="h-px bg-rm-border my-6" />

              <div>
                <h4 className="text-sm font-bold text-rm-text mb-4">Permissions</h4>
                <div className="space-y-2">
                  {PERMISSION_LIST.map(perm => {
                    const hasPerm = (state.editState.permissions & perm.mask) === perm.mask;
                    // Administrator role grants everything, visually lock them if Admin is checked
                    const isAdmin = (state.editState.permissions & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR;
                    const isDisabled = (isAdmin && perm.mask !== PERMISSIONS.ADMINISTRATOR);

                    return (
                      <label
                        htmlFor={`perm-${perm.mask}`}
                        key={perm.mask}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border",
                          hasPerm ? "bg-primary/5 border-primary/20" : "bg-rm-bg-surface border-rm-border cursor-pointer hover:border-rm-text/20",
                          isDisabled && "opacity-50 cursor-not-allowed"
                        )}
                        aria-label={perm.name}
                      >
                        <div>
                          <div className={cn("font-medium text-sm", hasPerm ? "text-primary" : "text-rm-text")}>{perm.name}</div>
                          <div className="text-xs text-rm-text-secondary mt-0.5">{perm.desc}</div>
                        </div>
                        <input
                          id={`perm-${perm.mask}`}
                          type="checkbox"
                          checked={hasPerm || isDisabled}
                          onChange={() => !isDisabled && togglePermission(perm.mask)}
                          disabled={isDisabled}
                          aria-label={perm.name}
                          className="w-4 h-4 rounded border-rm-border text-primary focus:ring-primary outline-none accent-primary"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-rm-text-muted">
            <Settings2 className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm font-medium">Select a role to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}

