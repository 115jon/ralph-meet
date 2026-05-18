import { AudioDeviceMenu } from "@/components/chat/AudioDeviceMenu";
import SettingsModal from "@/components/chat/SettingsModal";
import { VoiceDashboard } from "@/components/chat/VoiceDashboard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import type { ScreenShareOptions } from "@/lib/screen-share-types";
import { playCallEnd } from "@/lib/sounds";
import type { User } from "@/lib/types";
import { useDeviceAvailability } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { UnifiedScreenShareModal } from "../UnifiedScreenShareModal";

import { useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { ChevronDown, Headphones, Mic, MicOff, Settings } from "./Icons";
import UserAccountPopover from "./UserAccountPopover";

const EMPTY_QUALITIES: string[] = [];
const SCREEN_SHARE_QUALITIES = getAvailableStreamQualities();

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
  onStartScreenShare?: (options: ScreenShareOptions) => void;
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

function CallDashboardSection() {
  const callStatus = useCallStore((s) => s.status);
  const callChannelId = useCallStore((s) => s.channelId);
  const remoteUser = useCallStore((s) => s.remoteUser);

  const activeRemoteUser = useUserResolution(remoteUser?.id, remoteUser);

  // SFU state from the call voice store
  const sfu = useCallVoiceStore((s) => s.sfu);
  const isScreenSharing = useCallVoiceStore((s) => s.isScreenSharing);
  const isStreamingAudio = useCallVoiceStore((s) => s.isStreamingAudio);
  const screenQuality = useCallVoiceStore((s) => s.screenQuality);
  const isCameraActive = useCallVoiceStore((s) => s.isCameraActive);
  const hasCamera = useCallVoiceStore((s) => s.hasCamera);
  const hasMicrophone = useCallVoiceStore((s) => s.hasMicrophone);
  const toggleCamera = useCallVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useCallVoiceStore((s) => s.toggleScreenShare);
  const onToggleStreamAudio = useCallVoiceStore((s) => s.onToggleStreamAudio);

  const handleCallLeave = useCallVoiceStore((s) => s.handleLeave);

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);

  if (callStatus !== "active") return null;

  return (
    <>
      <VoiceDashboard
        serverName={activeRemoteUser.displayName || activeRemoteUser.username || "Call"}
        onVoiceDisconnect={() => {
          playCallEnd();
          handleCallLeave?.();
          // Fully reset the call store so dashboard, button, and context menu
          // all return to idle. The voice channel continues to exist for others.
          useCallStore.getState().endCall("left");
        }}
        isScreenSharing={isScreenSharing}
        isStreamingAudio={isStreamingAudio}
        screenQuality={screenQuality}
        availableQualities={getAvailableStreamQualities()}
        onStopStreaming={() => toggleScreenShare?.()}
        onToggleStreamAudio={() => onToggleStreamAudio?.()}
        onShareScreen={() => setIsScreenModalOpen(true)}
        onChangeStreamSource={() => setIsScreenModalOpen(true)}
        onStreamQualityChange={(q) => toggleScreenShare?.({ quality: q })}
        isCameraActive={isCameraActive}
        hasCamera={hasCamera}
        hasMicrophone={hasMicrophone}
        onToggleCamera={() => toggleCamera?.()}
        sfu={sfu}
        voiceChannelId={callChannelId}
      />
      <UnifiedScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
        onStart={({ quality, withAudio, sourceId, captureId, sourceName, sourceKind }) => {
          toggleScreenShare?.({
            quality,
            withAudio,
            changeSource: isScreenSharing,
            sourceId,
            captureId,
            sourceName,
            sourceKind,
          });
          setIsScreenModalOpen(false);
        }}
        availableQualities={getAvailableStreamQualities()}
      />
    </>
  );
}

export default function UserPanel({
  user,
  serverName,
  voiceConnected,
  voiceChannelId,
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
  onStartScreenShare,
  onStreamQualityChange,
  isCameraActive,
  hasCamera,
  hasMicrophone,
  onToggleCamera,
  sfu,
}: Props) {
  const { updateStatus } = useChatActions();
  const speakingUsers = useChatStore(s => s.speakingUsers);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"account" | "voice">("account");
  const [showMenu, setShowMenu] = useState(false);
  const [userAvatarEl, setUserAvatarEl] = useState<HTMLDivElement | null>(null);
  const [activeDeviceMenu, setActiveDeviceMenu] = useState<"input" | "output" | null>(null);
  const [isVcScreenModalOpen, setIsVcScreenModalOpen] = useState(false);
  const micCaretRef = useRef<HTMLButtonElement>(null);
  const headphoneCaretRef = useRef<HTMLButtonElement>(null);

  const settings = useVoiceSettingsStore(useShallow(s => s.getSettings(user?.id)));
  const setIsMuted = useVoiceSettingsStore(s => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore(s => s.setIsDeafened);
  const callActive = useCallStore(s => s.status) === "active";

  // Global device availability from the shared store — used for the bottom-bar
  // mute button so it stays accurate even when no VC/call is active.
  // When a VC IS active, the prop overrides (it comes from the same store anyway).
  const globalDevices = useDeviceAvailability();
  const effectiveHasMic = hasMicrophone ?? globalDevices.hasMicrophone;

  if (!user) return null;

  const currentStatus = user.status ?? "online";

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="mt-auto flex shrink-0 flex-col relative bg-rm-bg-elevated border border-white/5 rounded-lg m-2 shadow-lg"
        style={{ marginBottom: 'calc(8px + var(--safe-area-bottom, 0px))' }}
      >
        {/* VOICE CONNECTED dashboard (hidden when active call takes precedence) */}
        {voiceConnected && !callActive && (
          <>
            <VoiceDashboard
              serverName={serverName}
              voiceChannelName={voiceChannelName}
              onVoiceDisconnect={onVoiceDisconnect}
              onVoiceNavigate={onVoiceNavigate}
              isScreenSharing={isScreenSharing}
              isStreamingAudio={isStreamingAudio}
              screenQuality={screenQuality}
              availableQualities={availableQualities}
              onShareScreen={() => setIsVcScreenModalOpen(true)}
              onStopStreaming={onStopStreaming}
              onToggleStreamAudio={onToggleStreamAudio}
              onChangeStreamSource={onChangeStreamSource}
              onStreamQualityChange={onStreamQualityChange}
              isCameraActive={isCameraActive}
              hasCamera={hasCamera}
              hasMicrophone={hasMicrophone}
              onToggleCamera={onToggleCamera}
              sfu={sfu}
              voiceChannelId={voiceChannelId}
            />
            <UnifiedScreenShareModal
              isOpen={isVcScreenModalOpen}
              onClose={() => setIsVcScreenModalOpen(false)}
              onStart={({ quality, withAudio, sourceId, captureId, sourceName, sourceKind }) => {
                onStartScreenShare?.({
                  quality,
                  withAudio,
                  changeSource: isScreenSharing,
                  sourceId,
                  captureId,
                  sourceName,
                  sourceKind,
                });
                setIsVcScreenModalOpen(false);
              }}
              availableQualities={availableQualities ?? SCREEN_SHARE_QUALITIES}
            />
          </>
        )}

        {/* ACTIVE CALL dashboard (reuses VoiceDashboard) */}
        <CallDashboardSection />

        {/* User Info Bar */}
        <div className={cn(
          "flex items-center gap-2 p-1.5 relative",
          (voiceConnected || callActive) && "border-t border-white/5"
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
            <p className="truncate text-[13px] font-bold leading-tight text-rm-text-primary">{user.display_name || user.username}</p>
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
                      if (effectiveHasMic) {
                        // Route through callVoice.toggleMic when in a call (includes sound effects)
                        const callToggle = useCallVoiceStore.getState().toggleMic;
                        if (callActive && callToggle) {
                          callToggle();
                        } else {
                          setIsMuted(!settings.isMuted);
                        }
                      }
                    }}
                    disabled={!effectiveHasMic}
                    className={cn(
                      "rounded-[8px] p-1.5 transition-all outline-none flex items-center justify-center group",
                      (settings.isMuted || !effectiveHasMic)
                        ? "text-destructive hover:bg-rm-bg-hover"
                        : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary",
                      !effectiveHasMic && "cursor-not-allowed"
                    )}
                  >
                    {(settings.isMuted || !effectiveHasMic)
                      ? <MicOff size={18} />
                      : <Mic size={18} className="group-hover:animate-wiggle" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>{!effectiveHasMic ? "No microphone detected" : (settings.isMuted ? "Unmute" : "Mute")}</p>
                </TooltipContent>
              </Tooltip>

              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={micCaretRef}
                      onClick={() => setActiveDeviceMenu(activeDeviceMenu === 'input' ? null : 'input')}
                      className={cn(
                        "rounded-[8px] p-0.5 transition-all hover:bg-rm-bg-hover outline-none mr-0.5 group",
                        activeDeviceMenu === 'input' ? "text-rm-text-muted bg-rm-bg-hover" : "text-rm-text-muted/60 hover:text-rm-text-muted"
                      )}
                    >
                      <ChevronDown size={12} strokeWidth={3} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                    <p>Input Settings</p>
                  </TooltipContent>
                </Tooltip>
                {activeDeviceMenu === 'input' && (
                  <AudioDeviceMenu
                    mode="input"
                    anchorRef={micCaretRef}
                    onClose={() => setActiveDeviceMenu(null)}
                    onOpenVoiceSettings={() => {
                      setSettingsInitialTab('voice');
                      setShowSettings(true);
                    }}
                  />
                )}
              </div>
            </div>

            {/* Headphones Group */}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      // Route through callVoice.toggleDeafen when in a call (includes sound effects)
                      const callToggle = useCallVoiceStore.getState().toggleDeafen;
                      if (callActive && callToggle) {
                        callToggle();
                      } else {
                        setIsDeafened(!settings.isDeafened);
                      }
                    }}
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

              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={headphoneCaretRef}
                      onClick={() => setActiveDeviceMenu(activeDeviceMenu === 'output' ? null : 'output')}
                      className={cn(
                        "rounded-[8px] p-0.5 transition-all hover:bg-rm-bg-hover outline-none mr-0.5 group",
                        activeDeviceMenu === 'output' ? "text-rm-text-muted bg-rm-bg-hover" : "text-rm-text-muted/60 hover:text-rm-text-muted"
                      )}
                    >
                      <ChevronDown size={12} strokeWidth={3} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                    <p>Output Settings</p>
                  </TooltipContent>
                </Tooltip>
                {activeDeviceMenu === 'output' && (
                  <AudioDeviceMenu
                    mode="output"
                    anchorRef={headphoneCaretRef}
                    onClose={() => setActiveDeviceMenu(null)}
                    onOpenVoiceSettings={() => {
                      setSettingsInitialTab('voice');
                      setShowSettings(true);
                    }}
                  />
                )}
              </div>
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
          <SettingsModal
            initialTab={settingsInitialTab}
            onClose={() => {
              setShowSettings(false);
              setSettingsInitialTab("account"); // reset for next open
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
