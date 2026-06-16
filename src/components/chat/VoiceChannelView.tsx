import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import type { ScreenShareOptions } from "@/lib/screen-share-types";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useVoiceActivityStore } from "@/stores/useVoiceActivityStore";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ParticipantCard } from "../voice/ParticipantCard";
import { VoiceControls } from "../voice/VoiceControls";
import { VoiceGrid } from "../voice/VoiceGrid";
import { VoiceHeader } from "../voice/VoiceHeader";
import { VoiceLanding } from "../voice/VoiceLanding";
import { ChevronUp } from "./Icons";
import { WordleActivityStage } from "./WordleActivityStage";

const UnifiedScreenShareModal = lazy(() =>
  import("@/components/UnifiedScreenShareModal").then((mod) => ({ default: mod.UnifiedScreenShareModal }))
);

interface VoiceChannelViewProps {
  channelId: string;
  channelName: string;
  serverId: string;
  onToggleTextChat: () => void;
  showTextChat: boolean;
  onMenuClick?: () => void;
  onOpenActivities?: () => void;
  onJoined?: () => void;
  onLeft?: () => void;
  onStreamStateUpdate?: (state: {
    isScreenSharing: boolean;
    isStreamingAudio: boolean;
    screenQuality: string;
    availableQualities: string[];
    toggleScreenShare: (options?: ScreenShareOptions) => void;
    toggleStreamAudio: () => void;
    isCameraActive: boolean;
    hasCamera: boolean;
    hasMicrophone: boolean;
    toggleCamera: () => void;
    handleLeave: () => void;
    openScreenShareModal: () => void;
    sfu: any;
    gridItems: any[];
    spatialAudioState: any;
    updateSharedSpatialAudioState: (state: any) => void;
    settingsUserId: string;
    channelId: string;
  }) => void;
  autoJoin?: boolean;
  /**
   * Optional guard called when the user attempts to join this voice channel.
   * If provided, the landing page's "Join Voice" button will call this instead
   * of joining directly. The callback receives the actual join function to invoke
   * when ready (e.g. after a confirmation modal).
   */
  onBeforeJoin?: (doJoin: () => void) => void;
}

export default function VoiceChannelView({
  channelId,
  channelName,
  serverId,
  onToggleTextChat,
  showTextChat,
  onMenuClick,
  onOpenActivities,
  onJoined,
  onLeft,
  onStreamStateUpdate,
  autoJoin,
  onBeforeJoin,
}: VoiceChannelViewProps) {
  const {
    joined,
    isScreenSharing,
    localScreenStream,
    isStreamingAudio,
    currentScreenQuality,
    currentScreenSource,
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
    isMicOn,
    isDeafened,
    isCameraOn,
    vcMembers,
    hasMicrophone,
    hasCamera,
    sfu,
    spatialAudioState,
    updateSharedSpatialAudioState,
    settingsUserId,
    togglePreviewHidden,
    isPreviewHidden,
  } = useVoiceChannel({ channelId, serverId, onJoined, onLeft, autoJoin });

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const localUserId = useMemo(
    () => gridItems.find((item) => item.isLocal)?.userId ?? settingsUserId ?? null,
    [gridItems, settingsUserId]
  );
  const activeActivity = useVoiceActivityStore((state) => state.getUserActivity(localUserId, channelId));
  const setUserActivity = useVoiceActivityStore((state) => state.setUserActivity);
  const clearUserActivity = useVoiceActivityStore((state) => state.clearUserActivity);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastUpdateRef = useRef<string>("");

  const availableQualities = useMemo(() => getAvailableStreamQualities(), []);

  useEffect(() => {
    if (!sfu) return;
    return sfu.on("app-event", (event) => {
      if (event.type === "activity.start" && event.channelId === channelId && typeof event.userId === "string") {
        setUserActivity({
          userId: event.userId,
          channelId,
          activity: "wordle",
          startedAt: typeof event.startedAt === "number" ? event.startedAt : Date.now(),
        });
      }
      if (event.type === "activity.leave" && typeof event.userId === "string") {
        clearUserActivity(event.userId);
      }
    });
  }, [sfu, channelId, setUserActivity, clearUserActivity]);


  // Expose local stream state to parent
  useEffect(() => {
    const currentState = {
      isScreenSharing,
      isStreamingAudio,
      screenQuality: currentScreenQuality,
      isCameraActive,
      hasCamera,
      hasMicrophone,
      // Include sfu presence so the null→SFUClient transition fires the callback.
      sfuPresent: !!sfu,
      gridItemsCount: gridItems.length,
      spatialUpdatedAt: spatialAudioState?.updatedAt,
    };
    const stateHash = JSON.stringify(currentState);
    if (stateHash === lastUpdateRef.current) return;
    lastUpdateRef.current = stateHash;

    onStreamStateUpdate?.({
      isScreenSharing,
      isStreamingAudio,
      screenQuality: currentScreenQuality,
      isCameraActive,
      hasCamera,
      hasMicrophone,
      availableQualities,
      toggleScreenShare: (options) => {
        if (!options) {
          toggleScreenShare();
          return;
        }
        toggleScreenShare({
          ...options,
          quality: options.quality || currentScreenQuality,
          withAudio: options.withAudio !== undefined ? options.withAudio : isStreamingAudio,
        });
      },
      toggleStreamAudio: onToggleStreamAudio,
      toggleCamera,
      handleLeave,
      openScreenShareModal: () => setIsScreenModalOpen(true),
      sfu,
      gridItems,
      spatialAudioState,
      updateSharedSpatialAudioState,
      settingsUserId,
      channelId,
    });
  }, [isScreenSharing, isStreamingAudio, currentScreenQuality, toggleScreenShare, onToggleStreamAudio, isCameraActive, hasCamera, toggleCamera, handleLeave, onStreamStateUpdate, availableQualities, sfu, gridItems, spatialAudioState, updateSharedSpatialAudioState, settingsUserId]);


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

  const focusedItem = gridItems.find((i) => i.id === focusedId);

  // ── Not-connected landing page ──
  if (!joined) {
    return (
      <VoiceLanding
        channelName={channelName}
        vcMembers={vcMembers}
        handleJoin={onBeforeJoin ? () => onBeforeJoin(handleJoin) : handleJoin}
        showTextChat={showTextChat}
        onToggleTextChat={onToggleTextChat}
        onMenuClick={onMenuClick}
      />
    );
  }

  const voiceActions = {
    onToggleScreenShare: toggleScreenShare,
    isCurrentUserStreaming: isScreenSharing,
    currentScreenQuality: currentScreenQuality,
    currentScreenSource,
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
    togglePreviewHidden,
    isPreviewHidden,
    sfu,
    serverId,
    localUserId: settingsUserId,
  };

  // ── Connected state ──
  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-rm-bg-primary relative overflow-hidden group/cinema">
      {/* Absolute Header Overlay */}
      <VoiceHeader
        channelName={channelName}
        connectionState={connectionState}
        joined={joined}
        focusedItem={focusedItem}
        currentScreenQuality={currentScreenQuality}
        sfu={sfu}
        showTextChat={showTextChat}
        onToggleTextChat={onToggleTextChat}
        onMenuClick={onMenuClick}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="flex-1 relative min-h-0 bg-rm-bg-primary overflow-hidden flex items-center justify-center">
          {activeActivity?.activity === "wordle" ? (
            <div className="h-full w-full pt-16">
              <WordleActivityStage
                sfu={sfu}
                channelId={channelId}
                localUserId={localUserId}
                participants={gridItems
                  .filter((item) => item.type === "avatar" || item.type === "camera")
                  .map((item) => ({ userId: item.userId, name: item.name, avatar: item.avatar }))}
              />
            </div>
          ) : (
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
          )}
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
                      suppressVideo={focusedId === item.id}
                      onClick={() => setFocusedId(focusedId === item.id ? null : item.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls Bar */}
          <VoiceControls
            hasMicrophone={hasMicrophone}
            isMicOn={isMicOn}
            toggleMic={toggleMic}
            isDeafened={isDeafened}
            toggleDeafen={toggleDeafen}
            hasCamera={hasCamera}
            isCameraOn={isCameraOn}
            toggleCamera={toggleCamera}
            isScreenSharing={isScreenSharing}
            toggleScreenShare={toggleScreenShare}
            setIsScreenModalOpen={setIsScreenModalOpen}
            focusedItem={focusedItem}
            setFocusedId={setFocusedId}
            handleLeave={handleLeave}
            activeActivity={activeActivity?.activity}
            leaveActivity={() => {
              if (localUserId) {
                clearUserActivity(localUserId);
                sfu?.voiceGW.sendAppEvent({ type: "activity.leave", userId: localUserId, channelId });
              }
            }}
            isFullscreen={isFullscreen}
            toggleFs={toggleFs}
            showMembers={showMembers}
            setShowMembers={setShowMembers}
            ChevronUp={ChevronUp}
            onOpenActivities={onOpenActivities}
            settingsUserId={settingsUserId}
            sfu={sfu}
          />
        </div>
      </div>

      {/* Screen share modal: desktop gets the custom picker, web gets quality-only */}
      <Suspense fallback={null}>
        <UnifiedScreenShareModal
          isOpen={isScreenModalOpen}
          onClose={() => setIsScreenModalOpen(false)}
          onStart={(options) => {
            toggleScreenShare({
              ...options,
              changeSource: isScreenSharing,
            });
            setIsScreenModalOpen(false);
          }}
          availableQualities={voiceActions.availableQualities}
        />
      </Suspense>


    </div>
  );
}
