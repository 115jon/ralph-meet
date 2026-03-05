
import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";

import { isTauri } from "@/lib/platform";
import { useEffect, useMemo, useRef, useState } from "react";
import { DesktopScreenPickerModal } from "../DesktopScreenPickerModal";
import { ScreenShareModal } from "../ScreenShareModal";
import { AudioInteractionModal } from "../voice/AudioInteractionModal";
import { ParticipantCard } from "../voice/ParticipantCard";
import { QualityMonitor } from "../voice/QualityMonitor";
import { VoiceGrid } from "../voice/VoiceGrid";
import {
  ChevronUp,
  Headphones,
  Maximize2,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  Monitor,
  MonitorX,
  Phone,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  X
} from "./Icons";

interface VoiceChannelViewProps {
  channelId: string;
  channelName: string;
  serverId: string;
  onToggleTextChat: () => void;
  showTextChat: boolean;
  onMenuClick?: () => void;
  onJoined?: () => void;
  onLeft?: () => void;
  onStreamStateUpdate?: (state: {
    isScreenSharing: boolean;
    isStreamingAudio: boolean;
    screenQuality: string;
    availableQualities: string[];
    toggleScreenShare: (options?: { quality?: string; withAudio?: boolean; changeSource?: boolean }) => void;
    toggleStreamAudio: () => void;
    isCameraActive: boolean;
    hasCamera: boolean;
    hasMicrophone: boolean;
    toggleCamera: () => void;
    handleLeave: () => void;
    openScreenShareModal: () => void;
    sfu: any;
  }) => void;
  autoJoin?: boolean;
}

export default function VoiceChannelView({
  channelId,
  channelName,
  serverId,
  onToggleTextChat,
  showTextChat,
  onMenuClick,
  onJoined,
  onLeft,
  onStreamStateUpdate,
  autoJoin,
}: VoiceChannelViewProps) {
  const {
    joined,
    isScreenSharing,
    localScreenStream,
    isStreamingAudio,
    currentScreenQuality,
    isCameraActive,
    connectionState,
    focusedId,
    setFocusedId,
    watchedStreams,
    streamThumbnails,
    gridItems,
    handleJoin,
    handleLeave,
    toggleMic,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    onToggleStreamAudio,
    onToggleWatch,
    currentSettings,
    audioBlocked,
    setAudioBlocked,
    isMicOn,
    isDeafened,
    isCameraOn,
    vcMembers,
    hasMicrophone,
    hasCamera,
    sfu
  } = useVoiceChannel({ channelId, serverId, onJoined, onLeft, autoJoin });

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const callMenuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUpdateRef = useRef<string>("");

  const availableQualities = useMemo(() => getAvailableStreamQualities(), []);

  // Expose local stream state to parent
  useEffect(() => {
    const currentState = {
      isScreenSharing,
      isStreamingAudio,
      screenQuality: currentScreenQuality,
      isCameraActive,
      hasCamera,
      hasMicrophone,
    };
    const stateHash = JSON.stringify(currentState);
    if (stateHash === lastUpdateRef.current) return;
    lastUpdateRef.current = stateHash;

    onStreamStateUpdate?.({
      ...currentState,
      availableQualities,
      toggleScreenShare: (options) => {
        if (!options) {
          toggleScreenShare();
          return;
        }
        toggleScreenShare({
          quality: options.quality || currentScreenQuality,
          withAudio: options.withAudio !== undefined ? options.withAudio : isStreamingAudio,
          changeSource: options.changeSource
        });
      },
      toggleStreamAudio: onToggleStreamAudio,
      toggleCamera,
      handleLeave,
      openScreenShareModal: () => setIsScreenModalOpen(true),
      sfu,
    });
  }, [isScreenSharing, isStreamingAudio, currentScreenQuality, toggleScreenShare, onToggleStreamAudio, isCameraActive, hasCamera, toggleCamera, handleLeave, onStreamStateUpdate, availableQualities, sfu]);

  // Close call menu on outside click
  /* Removed showCallMenu cleanup */

  // Fullscreen change listener
  useEffect(() => {
    const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFs);
    return () => document.removeEventListener('fullscreenchange', handleFs);
  }, []);

  const toggleFs = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const focusedItem = gridItems.find(i => i.id === focusedId);

  // ── Not-connected landing page ──
  if (!joined) {
    return (
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-rm-bg-primary/60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--rm-glow)_0%,_transparent_70%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-rm-bg-primary/80 to-transparent" />

        <div className="relative z-10 h-14 flex items-center px-4 md:px-5 shrink-0 justify-between">
          <div className="flex items-center gap-2 text-rm-text-muted">
            {onMenuClick && (
              <button
                className="cursor-pointer border-none bg-transparent p-1 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
                onClick={onMenuClick}
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <Volume2 size={18} />
            <span className="text-sm font-bold text-rm-text tracking-tight">{channelName}</span>
          </div>
          {!showTextChat && (
            <button className="text-rm-text-muted hover:text-rm-text transition-colors outline-none" onClick={onToggleTextChat}>
              <MessageSquare size={18} />
            </button>
          )}
        </div>

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <h2 className="text-2xl font-bold text-rm-text/90 tracking-tight">{channelName}</h2>
          <p className="text-sm text-rm-text-muted font-medium">
            {vcMembers.length === 0
              ? 'No one is currently in voice'
              : `${vcMembers.length} ${vcMembers.length === 1 ? 'person' : 'people'} in voice`}
          </p>

          {vcMembers.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              {vcMembers.slice(0, 5).map(m => (
                <div key={m.clerk_user_id} className="w-8 h-8 rounded-full bg-rm-bg-elevated overflow-hidden ring-1 ring-rm-border">
                  {m.avatar_url ? (
                    <div className="relative h-full w-full">
                      <img
                        src={m.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-rm-text-muted">
                      {m.name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>
              ))}
              {vcMembers.length > 5 && (
                <div className="w-8 h-8 rounded-full bg-rm-bg-elevated flex items-center justify-center text-xs font-bold text-rm-text-muted ring-1 ring-rm-border">
                  +{vcMembers.length - 5}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleJoin}
            className="mt-4 px-8 py-2.5 bg-primary text-primary-foreground font-bold text-sm rounded-md hover:bg-primary/90 transition-all hover:shadow-[0_0_30px_var(--rm-glow)] active:scale-95 outline-none"
          >
            Join Voice
          </button>
        </div>
      </div>
    );
  }

  const voiceActions = {
    onToggleScreenShare: toggleScreenShare,
    isCurrentUserStreaming: isScreenSharing,
    currentScreenQuality: currentScreenQuality,
    isStreamingAudio: isStreamingAudio,
    onToggleStreamAudio: onToggleStreamAudio,
    onToggleWatch: onToggleWatch,
    watchedStreams: watchedStreams,
    availableQualities: getAvailableStreamQualities(),
    onLeave: handleLeave,
    isMuted: !isMicOn,
    onToggleMute: toggleMic,
    isDeafened,
    onToggleDeafen: toggleDeafen,
    onChangeSource: () => setIsScreenModalOpen(true),
    sfu
  };

  // ── Connected state ──
  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-rm-bg-primary relative overflow-hidden group/cinema">
      {/* Absolute Header Overlay */}
      <div className={cn(
        "absolute top-0 inset-x-0 h-16 flex items-center justify-between px-4 md:px-6 z-[100] transition-all duration-300 pointer-events-none",
        focusedId ? "bg-gradient-to-b from-rm-bg-primary/80 to-transparent" : "bg-rm-bg-primary/20"
      )}>
        <div className="flex items-center gap-2 md:gap-4 pointer-events-auto">
          {onMenuClick && (
            <button
              className="cursor-pointer border-none bg-transparent p-1 text-rm-text-muted transition-colors hover:text-rm-text md:hidden"
              onClick={onMenuClick}
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="flex items-center gap-2 text-rm-text-muted">
            <Volume2 size={18} />
            <span className="text-sm font-bold text-rm-text tracking-tight">{channelName}</span>
          </div>
          <div className="h-4 w-px bg-rm-border" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-rm-text-muted/40 uppercase tracking-widest">
              {connectionState === "connected" ? "Stable" :
                connectionState === "connecting" ? "Connecting" :
                  joined ? "Stable" :
                    connectionState === "new" ? "Connecting…" :
                      connectionState === "failed" ? "Failed" : connectionState}
            </span>
          </div>
          {focusedItem && (
            <>
              <div className="w-px h-4 bg-rm-border mx-1" />
              <div className="flex items-center gap-2 bg-rm-bg-elevated/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-rm-border">
                <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center bg-rm-bg-surface relative">
                  {focusedItem.avatar ? (
                    <img
                      src={focusedItem.avatar}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-rm-text">{focusedItem.name[0]}</span>
                  )}
                </div>
                <span className="text-xs font-bold text-rm-text/90">{focusedItem.name}{focusedItem.isStreaming ? "'s Screen" : ""}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          {focusedItem && focusedItem?.isStreaming && (
            <div className="flex items-center gap-1.5 bg-primary/10 backdrop-blur-md px-2.5 py-1 rounded-md border border-primary/20 mr-2 group/hw">
              <span className="text-[10px] font-black text-primary uppercase tracking-tight tabular-nums">
                <QualityMonitor
                  track={focusedItem.stream?.getVideoTracks()[0]}
                  signaledQuality={focusedItem.isLocal ? currentScreenQuality : null}
                  sfu={sfu}
                  userId={focusedItem.userId}
                  type={focusedItem.type === 'screen' ? 'screen' : 'cam'}
                />
              </span>
              <div className="bg-destructive px-1 rounded-[2px] text-[9px] font-black text-destructive-foreground uppercase animate-pulse">LIVE</div>
            </div>
          )}
          {!showTextChat && (
            <button title="Chat" className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-full transition-all outline-none" onClick={onToggleTextChat}>
              <MessageSquare size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="flex-1 relative min-h-0 bg-rm-bg-primary overflow-hidden flex items-center justify-center">
          <VoiceGrid
            items={gridItems}
            focusedId={focusedId}
            onFocus={setFocusedId}
            globalDeafened={isDeafened}
            currentSettings={currentSettings}
            watchedStreams={watchedStreams}
            streamThumbnails={streamThumbnails}
            voiceActions={voiceActions}
          />
        </div>

        {/* Bottom Panel */}
        <div className="flex-shrink-0 bg-rm-bg-surface border-t border-rm-border z-20 relative">
          {/* Members Tray */}
          {focusedId && showMembers && (
            <div className="p-4 bg-rm-bg-primary/20 backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-300 w-full overflow-hidden border-b border-rm-border">
              <div className="flex items-center gap-4 w-full overflow-x-auto no-scrollbar px-6 justify-start sm:justify-center" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {gridItems.map(item => (
                  <div key={item.id} className={cn(
                    "w-44 sm:w-52 aspect-video shrink-0 transition-all duration-300 py-2",
                    focusedId === item.id ? "" : "opacity-70 hover:opacity-100"
                  )}>
                    <ParticipantCard
                      item={item}
                      isFocused={focusedId === item.id}
                      isTray={true}
                      globalDeafened={isDeafened}
                      watchedStreams={watchedStreams}
                      streamThumbnails={streamThumbnails}
                      voiceActions={voiceActions}
                      onClick={() => setFocusedId(focusedId === item.id ? null : item.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls Bar */}
          <div className="h-[72px] flex items-center justify-between px-2 md:px-6 bg-rm-bg-elevated/40 overflow-x-auto scrollbar-none gap-2">
            <div className="hidden md:flex flex-1 items-center" />
            <div className="flex items-center gap-2 md:gap-3 shrink-0 mx-auto">
              <div className="flex items-center gap-0.5 md:gap-1 bg-rm-bg-surface p-1 rounded-2xl border border-rm-border shadow-2xl shrink-0">
                <button
                  title={!hasMicrophone ? "No microphone detected" : isMicOn ? "Mute" : "Unmute"}
                  disabled={!hasMicrophone}
                  onClick={toggleMic}
                  className={cn(
                    "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
                    (!isMicOn || !hasMicrophone) ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20" : "bg-rm-bg-hover/70 text-rm-text-primary hover:bg-rm-bg-hover hover:text-rm-text",
                    !hasMicrophone && "cursor-not-allowed"
                  )}
                >
                  {(!isMicOn || !hasMicrophone) ? <MicOff size={20} className="text-destructive-foreground" /> : <Mic size={20} />}
                </button>

                <button
                  title={isDeafened ? "Undeafen" : "Deafen"}
                  onClick={toggleDeafen}
                  className={cn(
                    "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
                    isDeafened ? "bg-destructive text-destructive-foreground" : "bg-rm-bg-hover/70 text-rm-text-primary hover:bg-rm-bg-hover hover:text-rm-text"
                  )}
                >
                  <Headphones size={20} className={isDeafened ? "text-destructive-foreground" : ""} />
                </button>

                <button
                  title={!hasCamera ? "No camera detected" : isCameraOn ? "Stop Camera" : "Start Camera"}
                  disabled={!hasCamera}
                  onClick={toggleCamera}
                  className={cn(
                    "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
                    isCameraOn ? "bg-rm-text text-rm-bg-surface shadow-lg" : "bg-rm-bg-hover/70 text-rm-text-primary hover:bg-rm-bg-hover hover:text-rm-text",
                    !hasCamera && "opacity-50 cursor-not-allowed grayscale"
                  )}
                >
                  {(isCameraOn) ? <Video size={20} /> : <VideoOff size={20} />}
                </button>

                <div className="w-px h-6 bg-rm-border mx-1" />

                <button
                  title={isScreenSharing ? "Stop Stream" : "Share Screen"}
                  onClick={() => {
                    if (isScreenSharing) toggleScreenShare();
                    else setIsScreenModalOpen(true);
                  }}
                  className={cn(
                    "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
                    isScreenSharing ? "bg-primary text-primary-foreground" : "bg-rm-bg-hover/70 text-rm-text-primary hover:bg-rm-bg-hover hover:text-rm-text"
                  )}
                >
                  {isScreenSharing ? <X size={20} className="text-primary-foreground" /> : <Monitor size={20} />}
                </button>
                <div className="hidden md:block w-px h-6 bg-rm-border mx-1" />
                <button title="Activities" className="w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center bg-rm-bg-hover/70 text-rm-text-primary hover:bg-rm-bg-hover hover:text-rm-text transition-all outline-none">
                  <Sparkles size={20} />
                </button>

                <div className="w-px h-6 bg-rm-border mx-1" />

                <button
                  title={focusedItem?.isStreaming ? "Stop Watching" : "Disconnect"}
                  onClick={focusedItem?.isStreaming ? () => setFocusedId(null) : handleLeave}
                  className="w-12 h-10 md:w-12 md:h-10 flex items-center justify-center bg-destructive text-destructive-foreground rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all shrink-0 ml-1 md:ml-0"
                >
                  <div className="relative w-5 h-5 flex items-center justify-center">
                    <div className={cn(
                      "absolute inset-0 transition-all duration-300 ease-in-out flex items-center justify-center",
                      focusedItem?.isStreaming ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-75 rotate-45"
                    )}>
                      <MonitorX size={20} className="text-destructive-foreground" />
                    </div>
                    <div className={cn(
                      "absolute inset-0 transition-all duration-300 ease-in-out flex items-center justify-center",
                      !focusedItem?.isStreaming ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-75 -rotate-45"
                    )}>
                      <Phone size={20} className="text-destructive-foreground" />
                    </div>
                  </div>
                </button>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-end gap-1 md:gap-3 shrink-0">
              <button
                onClick={toggleFs}
                className="p-1 md:p-2 text-rm-text-primary bg-rm-bg-hover/50 hover:bg-rm-bg-hover rounded-xl transition-all outline-none"
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? <Minimize size={20} /> : <Maximize2 size={20} />}
              </button>
              <button
                onClick={() => setShowMembers(!showMembers)}
                className={cn(
                  "p-1 md:p-2 rounded-xl transition-all outline-none",
                  showMembers ? "text-rm-text bg-rm-bg-active" : "text-rm-text-primary bg-rm-bg-hover/50 hover:bg-rm-bg-hover"
                )}
                title={showMembers ? "Hide Members" : "Show Members"}
              >
                <ChevronUp className={cn("transition-transform", !showMembers && "rotate-180")} size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Screen share modal: desktop gets the full picker, web gets quality-only */}
      {isTauri() ? (
        <DesktopScreenPickerModal
          isOpen={isScreenModalOpen}
          onClose={() => setIsScreenModalOpen(false)}
          onStart={({ quality, withAudio, sourceId }) => {
            toggleScreenShare({ quality, withAudio, sourceId });
            setIsScreenModalOpen(false);
          }}
          availableQualities={voiceActions.availableQualities}
        />
      ) : (
        <ScreenShareModal
          isOpen={isScreenModalOpen}
          onClose={() => setIsScreenModalOpen(false)}
          onStart={({ quality, withAudio }) => {
            toggleScreenShare({ quality, withAudio });
            setIsScreenModalOpen(false);
          }}
          availableQualities={voiceActions.availableQualities}
        />
      )}

      {audioBlocked && (
        <AudioInteractionModal
          onInteract={() => {
            sfu?.resumeAudioContext();
            setAudioBlocked(false);
          }}
          onClose={() => setAudioBlocked(false)}
        />
      )}
    </div>
  );
}
