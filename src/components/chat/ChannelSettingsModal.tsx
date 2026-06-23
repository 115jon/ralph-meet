
import { BaseModal } from "@/components/ui/BaseModal";
import { apiPatch } from '@/lib/api-client';
import type { Channel } from '@/lib/types';
import { cn } from '@/lib/utils';
import { sanitizeChannelName } from '@/lib/validations';
import { Hash, Loader2, Settings2, Shield, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ChannelPermissionsTab from './ChannelPermissionsTab';

interface ChannelSettingsModalProps {
  serverId: string;
  channel: Channel;
  userPermissions?: number | null;
  onClose: () => void;
  onUpdated?: (updates: { name?: string; description?: string | null }) => void;
  isClosing?: boolean;
}

export default function ChannelSettingsModal({
  serverId,
  channel,
  onClose,
  onUpdated,
  isClosing,
}: ChannelSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'permissions'>('overview');

  // Overview form state
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? '');
  const [shareOverride, setShareOverride] = useState<boolean | null>(channel.allow_public_shares ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset when channel changes
  useEffect(() => {
    setName(channel.name);
    setDescription(channel.description ?? '');
    setShareOverride(channel.allow_public_shares ?? null);
    setError(null);
  }, [channel.id, channel.name, channel.description, channel.allow_public_shares]);

  // Live-preview sanitized name for text channels
  const previewName = channel.channel_type === 'text'
    ? sanitizeChannelName(name, 'text', false)
    : name;

  const finalName = channel.channel_type === 'text'
    ? sanitizeChannelName(name, 'text', true)
    : name.trim();

  const hasChanges =
    (finalName !== channel.name) ||
    ((description || null) !== (channel.description || null)) ||
    (shareOverride !== (channel.allow_public_shares ?? null));

  const handleSave = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setError(null);

    try {
      const updates: { name?: string; description?: string | null; allow_public_shares?: boolean | null } = {};
      if (finalName !== channel.name) updates.name = finalName;
      if ((description || null) !== (channel.description || null)) {
        updates.description = description || null;
      }
      if (shareOverride !== (channel.allow_public_shares ?? null)) {
        updates.allow_public_shares = shareOverride;
      }

      await apiPatch(`/api/channels/${channel.id}`, updates);

      // Flash success
      setSuccessFlash(true);
      setTimeout(() => setSuccessFlash(false), 2000);

      onUpdated?.(updates);
    } catch (err: any) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const ChannelTypeIcon = channel.channel_type === 'voice' ? Volume2 : Hash;

  return (
    <BaseModal onClose={onClose}>
      <div
        className={cn("fixed inset-0 z-1000 flex flex-col items-center justify-end md:justify-center p-0 md:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 pointer-events-none", isClosing && "animate-out fade-out")}
        onClick={onClose}
        onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        role="presentation"
      >
        <div
          className={cn("relative flex flex-col md:flex-row w-full h-full md:h-full md:max-h-[820px] md:max-w-[1040px] md:rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary md:border border-rm-border animate-in slide-in-from-bottom-full md:slide-in-from-bottom-0 md:fade-in duration-300 md:duration-200 pointer-events-auto", isClosing && "animate-out slide-out-to-bottom-full md:slide-out-to-bottom-0 md:fade-out")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          {/* Mobile header with close button */}
          <div
            className="w-full flex justify-between items-center pb-3 px-4 md:hidden bg-rm-server-bar shrink-0 border-b border-rm-border/50"
            style={{ paddingTop: 'calc(16px + var(--safe-area-top, 0px))' }}
          >
            <h2 className="text-[13px] font-bold tracking-widest text-rm-text-muted truncate">
              <ChannelTypeIcon className="inline h-3 w-3 mr-1 -mt-0.5 opacity-60" />
              {channel.name}
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-full bg-rm-bg-surface text-rm-text flex items-center justify-center hover:bg-rm-bg-hover active:scale-95 transition-all"
            >
              <X size={18} />
            </button>
          </div>

          {/* Sidebar */}
          <div className="w-full md:w-[218px] flex flex-row md:flex-col shrink-0 bg-rm-server-bar pt-2 md:pt-[60px] pb-2 px-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden custom-scrollbar border-b md:border-b-0 md:border-r border-rm-border/50 gap-2 md:gap-0">
            <div className="hidden md:block mb-2 px-2">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted truncate block w-[180px]" title={channel.name}>
                <ChannelTypeIcon className="inline h-3 w-3 mr-1 -mt-0.5 opacity-60" />
                {channel.name}
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

            <button
              onClick={() => setActiveTab('permissions')}
              className={cn(
                "w-auto md:w-full shrink-0 text-left px-4 md:px-3 py-2 rounded-full md:rounded-lg text-[13px] md:text-sm font-bold md:font-medium transition-colors flex items-center gap-2 mb-0 md:mb-1",
                activeTab === 'permissions' ? "bg-primary text-primary-foreground md:bg-primary/10 md:text-primary" : "text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text bg-rm-bg-elevated/50 md:bg-transparent"
              )}
            >
              <Shield className="h-4 w-4" /> Permissions
            </button>
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
              {activeTab === 'permissions' ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full h-full">
                  <h2 id="channel-settings-title" className="mb-6 text-xl font-bold text-rm-text">Permissions</h2>
                  <ChannelPermissionsTab serverId={serverId} channelId={channel.id} isVoice={channel.channel_type === 'voice'} />
                </div>
              ) : (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full">
                  <h2 id="channel-settings-title" className="mb-6 text-xl font-bold text-rm-text">
                    Channel Overview
                  </h2>

                  <div className="space-y-8 max-w-xl">
                    {/* Channel Type Badge */}
                    <div className="space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted block">Channel Type</span>
                      <div className="inline-flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-surface px-3 py-2 text-sm font-medium text-rm-text-secondary">
                        <ChannelTypeIcon className="h-4 w-4 opacity-60" />
                        {channel.channel_type === 'voice' ? 'Voice Channel' : 'Text Channel'}
                      </div>
                    </div>

                    {/* Channel Name */}
                    <div className="space-y-3">
                      <label htmlFor="channel-name-setting" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted block">
                        Channel Name
                      </label>
                      <input
                        ref={nameInputRef}
                        id="channel-name-setting"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full max-w-sm rounded-lg border border-rm-border bg-rm-bg-surface px-4 py-2.5 text-[15px] text-rm-text outline-none transition-all placeholder:text-rm-text-muted/40 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                        placeholder="channel-name"
                      />
                      {/* Live preview for text channels */}
                      {channel.channel_type === 'text' && previewName !== name && (
                        <p className="text-[12px] text-rm-text-muted flex items-center gap-1.5">
                          <Hash className="h-3 w-3 opacity-40" />
                          Preview: <span className="font-medium text-rm-text-secondary">{previewName || '—'}</span>
                        </p>
                      )}
                    </div>

                    {/* Channel Description / Topic */}
                    <div className="space-y-3">
                      <label htmlFor="channel-description-setting" className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted block">
                        Channel Topic
                      </label>
                      <textarea
                        id="channel-description-setting"
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 1024))}
                        rows={3}
                        className="w-full rounded-lg border border-rm-border bg-rm-bg-surface px-4 py-2.5 text-[15px] text-rm-text outline-none transition-all placeholder:text-rm-text-muted/40 focus:border-primary/40 focus:ring-2 focus:ring-primary/20 resize-none"
                        placeholder="Let everyone know what this channel is about"
                      />
                      <p className="text-[11px] text-rm-text-muted text-right">{description.length} / 1024</p>
                    </div>

                    {/* Error */}
                    <div className="space-y-3">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted block">
                        Public Sharing
                      </span>
                      <select
                        value={shareOverride === null ? "inherit" : shareOverride ? "allow" : "deny"}
                        onChange={(event) => {
                          const value = event.target.value;
                          setShareOverride(value === "inherit" ? null : value === "allow");
                        }}
                        className="w-full max-w-sm rounded-lg border border-rm-border bg-rm-bg-surface px-4 py-2.5 text-[15px] text-rm-text outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="inherit">Inherit server default</option>
                        <option value="allow">Allow public shares</option>
                        <option value="deny">Disable public shares</option>
                      </select>
                    </div>

                    {/* Error */}
                    {error && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                        {error}
                      </div>
                    )}

                    {/* Save Button */}
                    <button
                      onClick={handleSave}
                      disabled={!hasChanges || saving}
                      className={cn(
                        "flex max-w-fit items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-lg transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed",
                        successFlash
                          ? "bg-green-500 text-white shadow-green-500/20"
                          : "bg-primary text-primary-foreground shadow-primary/20"
                      )}
                    >
                      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {successFlash ? '✓ Saved!' : saving ? 'Saving...' : 'Save Changes'}
                    </button>

                    {/* Channel Info */}
                    <div className="pt-4 border-t border-rm-border/50">
                      <p className="text-[11px] text-rm-text-muted">
                        Created {new Date(channel.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
