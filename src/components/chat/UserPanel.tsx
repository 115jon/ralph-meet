import SettingsModal from "@/components/chat/SettingsModal";
import { VoiceDashboard } from "@/components/chat/VoiceDashboard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getAuthAssetUrl } from "@/lib/platform";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions, useChatState } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

import { useState } from "react";
import { useShallow } from "zustand/shallow";
import { ChevronDown, Headphones, Mic, MicOff, Settings } from "./Icons";
import UserAccountPopover from "./UserAccountPopover";

const EMPTY_QUALITIES: string[] = [];

interface Props {
  user: User | null;
  serverName: string;
  // Voice dashboard
  voiceConnected?: boolean;
  voiceChannelId?: string | null;
  voiceChannelName?: string;
  onVoiceDisconnect?: () => void;
  onVoiceNavigate?: () => void;
  // Streaming state for local user
  isScreenSharing?: boolean;
  isStreamingAudio?: boolean;
  screenQuality?: string;
  availableQualities?: string[];
  onStopStreaming?: () => void;
  onToggleStreamAudio?: () => void;
  onChangeStreamSource?: () => void;
  onStreamQualityChange?: (quality: string) => void;
  isCameraActive?: boolean;
  hasCamera?: boolean;
  hasMicrophone?: boolean;
  onToggleCamera?: () => void;
  sfu?: any;
}

const STATUS_OPTIONS = [
  { value: "online" as const, label: "Online", color: "bg-primary" },
  { value: "idle" as const, label: "Idle", color: "bg-warning" },
  { value: "dnd" as const, label: "Do Not Disturb", color: "bg-destructive" },
  { value: "offline" as const, label: "Invisible", color: "bg-rm-text-muted/40" },
];

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

export default function UserPanel({
  user,
  serverName,
  voiceConnected,
  voiceChannelName,
  onVoiceDisconnect,
  onVoiceNavigate,
  isScreenSharing,
  isStreamingAudio,
  screenQuality,
  availableQualities = EMPTY_QUALITIES,
  onStopStreaming,
  onToggleStreamAudio,
  onChangeStreamSource,
  onStreamQualityChange,
  isCameraActive,
  hasCamera,
  hasMicrophone,
  onToggleCamera,
  sfu,
}: Props) {
  const { updateStatus } = useChatActions();
  const { speakingUsers } = useChatState();
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [userAvatarEl, setUserAvatarEl] = useState<HTMLDivElement | null>(null);

  const settings = useVoiceSettingsStore(useShallow(s => s.getSettings(user?.id)));
  const setIsMuted = useVoiceSettingsStore(s => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore(s => s.setIsDeafened);

  if (!user) return null;

  const currentStatus = user.status ?? "online";

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="mt-auto flex shrink-0 flex-col relative bg-rm-bg-elevated border border-white/5 rounded-lg m-2 shadow-lg"
        style={{ marginBottom: 'calc(8px + var(--safe-area-bottom, 0px))' }}
      >
        {/* VOICE CONNECTED dashboard */}
        {voiceConnected && (
          <VoiceDashboard
            serverName={serverName}
            voiceChannelName={voiceChannelName}
            onVoiceDisconnect={onVoiceDisconnect}
            onVoiceNavigate={onVoiceNavigate}
            isScreenSharing={isScreenSharing}
            isStreamingAudio={isStreamingAudio}
            screenQuality={screenQuality}
            availableQualities={availableQualities}
            onStopStreaming={onStopStreaming}
            onToggleStreamAudio={onToggleStreamAudio}
            onChangeStreamSource={onChangeStreamSource}
            onStreamQualityChange={onStreamQualityChange}
            isCameraActive={isCameraActive}
            hasCamera={hasCamera}
            hasMicrophone={hasMicrophone}
            onToggleCamera={onToggleCamera}
            sfu={sfu}
          />
        )}

        {/* User Info Bar */}
        <div className={cn(
          "flex items-center gap-2 p-1.5 relative",
          voiceConnected && "border-t border-white/5"
        )}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                ref={setUserAvatarEl}
                className="group relative cursor-pointer outline-none pl-0.5"
                onClick={() => setShowMenu((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShowMenu((v) => !v);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="View user account"
              >
                <div className={cn(
                  "relative z-10 flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground transition-all opacity-90 group-hover:opacity-100",
                  speakingUsers[user.id] && "ring-[3px] ring-primary shadow-[0_0_20px_var(--rm-glow)] ring-offset-2 ring-offset-rm-bg-elevated"
                )}>
                  <div className="absolute inset-0 overflow-hidden rounded-full flex items-center justify-center">
                    {user.avatar_url ? (
                      <img src={getAuthAssetUrl(user.avatar_url)} alt={user.username} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
                    ) : (
                      user.username[0]?.toUpperCase()
                    )}
                  </div>
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 z-20 rounded-full bg-rm-bg-elevated p-[2.5px]">
                  <div className={cn(
                    "flex h-[11px] w-[11px] items-center justify-center rounded-full",
                    statusColors[currentStatus]
                  )}>
                    {currentStatus === "offline" && <div className="h-[5px] w-[5px] rounded-full bg-rm-bg-elevated" />}
                    {currentStatus === "dnd" && <div className="h-[2px] w-[6px] rounded-sm bg-rm-bg-elevated" />}
                  </div>
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
              <p>View Profile</p>
            </TooltipContent>
          </Tooltip>

          <div className="min-w-0 flex-1 py-1 cursor-pointer group/name rounded hover:bg-rm-bg-hover/50 px-1 -ml-1">
            <p className="truncate text-[13px] font-bold leading-tight text-rm-text-primary">{user.username}</p>
            <p className="truncate text-[11px] leading-tight text-rm-text-muted">
              {currentStatus === "online" ? "Online" :
                currentStatus === "idle" ? "Away" :
                  currentStatus === "dnd" ? "Do Not Disturb" : "Invisible"}
            </p>
          </div>

          <div className="flex items-center -mr-1">
            {/* Mic Group */}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (hasMicrophone !== false) {
                        setIsMuted(!settings.isMuted);
                      }
                    }}
                    disabled={hasMicrophone === false}
                    className={cn(
                      "rounded-[8px] p-1.5 transition-all outline-none flex items-center justify-center group",
                      (settings.isMuted || hasMicrophone === false)
                        ? "text-destructive hover:bg-rm-bg-hover"
                        : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary",
                      hasMicrophone === false && "cursor-not-allowed"
                    )}
                  >
                    {(settings.isMuted || hasMicrophone === false)
                      ? <MicOff size={18} />
                      : <Mic size={18} className="group-hover:animate-wiggle" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>{hasMicrophone === false ? "No microphone detected" : (settings.isMuted ? "Unmute" : "Mute")}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="rounded-[8px] p-0.5 text-rm-text-muted/60 transition-all hover:bg-rm-bg-hover hover:text-rm-text-muted outline-none mr-0.5 group">
                    <ChevronDown size={12} strokeWidth={3} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>Input Settings</p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Headphones Group */}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIsDeafened(!settings.isDeafened)}
                    className={cn(
                      "rounded-[8px] p-1.5 transition-all outline-none flex items-center justify-center group",
                      settings.isDeafened
                        ? "text-destructive hover:bg-rm-bg-hover"
                        : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary"
                    )}
                  >
                    <Headphones size={18} className="group-hover:animate-clack" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>{settings.isDeafened ? "Undeafen" : "Deafen"}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="rounded-[8px] p-0.5 text-rm-text-muted/60 transition-all hover:bg-rm-bg-hover hover:text-rm-text-muted outline-none mr-0.5 group">
                    <ChevronDown size={12} strokeWidth={3} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>Output Settings</p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Settings */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowSettings(true)}
                  className="rounded-[8px] p-1.5 text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text-secondary outline-none flex items-center justify-center group"
                >
                  <Settings size={18} className="transition-transform duration-500 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] group-hover:rotate-90" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                <p>User Settings</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* User Account Popover */}
        {showMenu && userAvatarEl && (
          <UserAccountPopover
            user={user}
            onClose={() => setShowMenu(false)}
            updateStatus={updateStatus}
            anchorEl={userAvatarEl}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
        {/* Settings Modal */}
        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} />
        )}
      </div>
    </TooltipProvider>
  );
}
