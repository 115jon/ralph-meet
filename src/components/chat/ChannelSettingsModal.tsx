
import { BaseModal } from "@/components/ui/BaseModal";
import type { Channel } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Settings2, Shield, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import ChannelPermissionsTab from './ChannelPermissionsTab';
interface ChannelSettingsModalProps {
  serverId: string;
  channel: Channel;
  userPermissions?: number | null; // Currently not passed directly, but we can assume if they can open this they have MANAGE_CHANNELS
  onClose: () => void;
}

export default function ChannelSettingsModal({
  serverId,
  channel,
  onClose,
}: ChannelSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'permissions'>('permissions');

  // Close on Escape
  

  

  return (
    <BaseModal onClose={onClose}>
      <div
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-end md:justify-center p-0 md:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 pointer-events-none"
      onClick={onClose}
      onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      role="presentation"
    >
      <div
        className="relative flex flex-col md:flex-row w-full h-[95vh] md:h-full md:max-h-[820px] md:max-w-[1040px] rounded-t-[24px] md:rounded-xl overflow-hidden shadow-2xl bg-rm-bg-primary border border-rm-border animate-in slide-in-from-bottom-full md:slide-in-from-bottom-0 md:fade-in duration-300 md:duration-200 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        {/* Mobile drag handle */}
        <div className="w-full flex justify-center pt-3 pb-1 md:hidden bg-rm-server-bar shrink-0">
          <div className="w-12 h-1.5 rounded-full bg-rm-bg-hover" />
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-[218px] flex flex-row md:flex-col shrink-0 bg-rm-server-bar pt-2 md:pt-[60px] pb-2 px-4 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden custom-scrollbar border-b md:border-b-0 md:border-r border-rm-border/50 gap-2 md:gap-0">
          <div className="hidden md:block mb-2 px-2">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-rm-text-muted truncate block w-[180px]" title={channel.name}>
              # {channel.name}
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
              <div className="animate-in fade-in slide-in-from-right-4 duration-300 w-full flex flex-col items-center justify-center h-full text-rm-text-muted">
                <Settings2 className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-sm">Overview settings coming soon.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </BaseModal>
  );
}
