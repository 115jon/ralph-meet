import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import type { ScreenShareOptions, ScreenShareSourceState } from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { isVoiceActivityType, useVoiceActivityStore } from "@/stores/useVoiceActivityStore";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ParticipantCard } from "../voice/ParticipantCard";
import { VoiceControls } from "../voice/VoiceControls";
import { VoiceGrid } from "../voice/VoiceGrid";
import { VoiceHeader } from "../voice/VoiceHeader";
import { VoiceLanding } from "../voice/VoiceLanding";
import { ChevronUp } from "./Icons";

const UnifiedScreenShareModal = lazy(() =>
  import("@/components/UnifiedScreenShareModal").then((mod) => ({ default: mod.UnifiedScreenShareModal }))
);
const WordleActivityStage = lazy(() =>
  import("./WordleActivityStage").then((mod) => ({ default: mod.WordleActivityStage }))
);
const WarpRushActivityStage = lazy(() =>
  import("./WarpRushActivityStage").then((mod) => ({ default: mod.WarpRushActivityStage }))
);

export interface VoiceSessionStreamState {
  joined: boolean;
  isScreenSharing: boolean;
  isStreamingAudio: boolean;
  alwaysShowStreamPreview: boolean;
  screenQuality: string;
  currentScreenSource: ScreenShareSourceState | null;
  availableQualities: string[];
  isMicOn: boolean;
  isDeafened: boolean;
  toggleMic: () => void;
  toggleDeafen: () => void;
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
  streamThumbnails: Record<string, string>;
  watchedStreams: Record<string, boolean>;
  watchersByStreamer: StreamWatchersByStreamer;
  onToggleWatch: (userId: string) => void;
  watchAndFocusStreamByUserId: (userId: string) => boolean;
  spatialAudioState: any;
  updateSharedSpatialAudioState: (state: any) => void;
  settingsUserId: string;
  channelId: string;
  roomSlug: string | null;
  voiceSessionId: string | null;
  isPreviewHidden: boolean;
  togglePreviewHidden: () => Promise<void> | void;
  onToggleAlwaysShowStreamPreview: () => void;
}

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
  onStreamStateUpdate?: (state: VoiceSessionStreamState) => void;
  autoJoin?: boolean;
  onOpenProfileUser?: (userId: string) => void;
  onOpenMessageUser?: (userId: string) => void;
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
  onOpenProfileUser,
  onOpenMessageUser,
  onBeforeJoin,
}: VoiceChannelViewProps) {
  const {
    joined,
    isScreenSharing,
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
    watchersByStreamer,
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
    roomSlug,
    voiceSessionId,
    togglePreviewHidden,
    isPreviewHidden,
    alwaysShowStreamPreview,
    onToggleAlwaysShowStreamPreview,
  } = useVoiceChannel({ channelId, serverId, onJoined, onLeft, autoJoin });

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const gridItemsRef = useRef(gridItems);
  const watchedStreamsRef = useRef(watchedStreams);
  const openScreenShareModal = useCallback(() => {
    setIsScreenModalOpen(true);
  }, []);
  const localUserId = useMemo(
    () => gridItems.find((item) => item.isLocal)?.userId ?? settingsUserId ?? null,
    [gridItems, settingsUserId]
  );
  const activeActivity = useVoiceActivityStore((state) => state.getUserActivity(localUserId, channelId));
  const setUserActivity = useVoiceActivityStore((state) => state.setUserActivity);
  const clearUserActivity = useVoiceActivityStore((state) => state.clearUserActivity);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastUpdateRef = useRef<string>("");
  const lastActionRefs = useRef<null | {
    toggleMic: VoiceSessionStreamState["toggleMic"];
    toggleDeafen: VoiceSessionStreamState["toggleDeafen"];
    toggleScreenShare: VoiceSessionStreamState["toggleScreenShare"];
    toggleStreamAudio: VoiceSessionStreamState["toggleStreamAudio"];
    toggleCamera: VoiceSessionStreamState["toggleCamera"];
    handleLeave: VoiceSessionStreamState["handleLeave"];
    openScreenShareModal: VoiceSessionStreamState["openScreenShareModal"];
    onToggleWatch: VoiceSessionStreamState["onToggleWatch"];
    watchAndFocusStreamByUserId: VoiceSessionStreamState["watchAndFocusStreamByUserId"];
    updateSharedSpatialAudioState: VoiceSessionStreamState["updateSharedSpatialAudioState"];
    togglePreviewHidden: VoiceSessionStreamState["togglePreviewHidden"];
    onToggleAlwaysShowStreamPreview: VoiceSessionStreamState["onToggleAlwaysShowStreamPreview"];
  }>(null);

  const availableQualities = useMemo(() => getAvailableStreamQualities(), []);

  useEffect(() => {
    gridItemsRef.current = gridItems;
  }, [gridItems]);

  useEffect(() => {
    watchedStreamsRef.current = watchedStreams;
  }, [watchedStreams]);

  const watchAndFocusStreamByUserId = useCallback(
    (userId: string) => {
      const screenItem = gridItemsRef.current.find((item) => item.type === "screen" && item.userId === userId);
      if (!screenItem) {
        return false;
      }

      if (!screenItem.isLocal && !watchedStreamsRef.current[userId]) {
        onToggleWatch(userId);
      }

      setFocusedId(screenItem.id);
      return true;
    },
    [onToggleWatch, setFocusedId],
  );

  // `sfu.on(...)` returns the unsubscribe function from EventEmitter.on.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!sfu) return;
    return sfu.on("app-event", (event) => {
      if (
        event.type === "activity.start"
        && event.channelId === channelId
        && typeof event.userId === "string"
        && isVoiceActivityType(event.activity)
      ) {
        setUserActivity({
          userId: event.userId,
          channelId,
          activity: event.activity,
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
      joined,
      isScreenSharing,
      isStreamingAudio,
      screenQuality: currentScreenQuality,
      isMicOn,
      isDeafened,
      isCameraActive,
      hasCamera,
      hasMicrophone,
      // Include sfu presence so the null→SFUClient transition fires the callback.
      sfuPresent: !!sfu,
      gridItemsCount: gridItems.length,
      gridSignature: JSON.stringify(
        gridItems.map((item) => ({
          id: item.id,
          userId: item.userId,
          name: item.name,
          type: item.type,
          isLocal: item.isLocal,
          hasStream: !!item.stream,
        })),
      ),
      streamThumbnailSignature: JSON.stringify(streamThumbnails),
      watcherSignature: JSON.stringify(
        Object.fromEntries(
          Object.entries(watchersByStreamer).map(([streamerUserId, watchers]) => [
            streamerUserId,
            watchers.map((watcher) => watcher.userId),
          ]),
        ),
      ),
      currentScreenSourceSignature: currentScreenSource
        ? JSON.stringify({
            sourceId: currentScreenSource.sourceId,
            captureId: currentScreenSource.captureId,
            sourceName: currentScreenSource.sourceName,
            sourceKind: currentScreenSource.sourceKind,
            sourceAppName: currentScreenSource.sourceAppName,
            hasSourceIcon: !!currentScreenSource.sourceIcon,
          })
        : null,
      spatialUpdatedAt: spatialAudioState?.updatedAt,
      isPreviewHidden,
      alwaysShowStreamPreview,
    };
    const stateHash = JSON.stringify(currentState);
    const callbacksChanged = !lastActionRefs.current
      || lastActionRefs.current.toggleMic !== toggleMic
      || lastActionRefs.current.toggleDeafen !== toggleDeafen
      || lastActionRefs.current.toggleScreenShare !== toggleScreenShare
      || lastActionRefs.current.toggleStreamAudio !== onToggleStreamAudio
      || lastActionRefs.current.toggleCamera !== toggleCamera
      || lastActionRefs.current.handleLeave !== handleLeave
      || lastActionRefs.current.openScreenShareModal !== openScreenShareModal
      || lastActionRefs.current.onToggleWatch !== onToggleWatch
      || lastActionRefs.current.watchAndFocusStreamByUserId !== watchAndFocusStreamByUserId
      || lastActionRefs.current.updateSharedSpatialAudioState !== updateSharedSpatialAudioState
      || lastActionRefs.current.togglePreviewHidden !== togglePreviewHidden
      || lastActionRefs.current.onToggleAlwaysShowStreamPreview !== onToggleAlwaysShowStreamPreview;
    if (stateHash === lastUpdateRef.current && !callbacksChanged) return;
    lastUpdateRef.current = stateHash;
    lastActionRefs.current = {
      toggleMic,
      toggleDeafen,
      toggleScreenShare,
      toggleStreamAudio: onToggleStreamAudio,
      toggleCamera,
      handleLeave,
      openScreenShareModal,
      onToggleWatch,
      watchAndFocusStreamByUserId,
      updateSharedSpatialAudioState,
      togglePreviewHidden,
      onToggleAlwaysShowStreamPreview,
    };

    onStreamStateUpdate?.({
      joined,
      isScreenSharing,
      isStreamingAudio,
      alwaysShowStreamPreview,
      screenQuality: currentScreenQuality,
      currentScreenSource: currentScreenSource ?? null,
      isMicOn,
      isDeafened,
      isCameraActive,
      hasCamera,
      hasMicrophone,
      availableQualities,
      toggleMic,
      toggleDeafen,
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
      openScreenShareModal,
      sfu,
      gridItems,
      streamThumbnails,
      watchedStreams,
      watchersByStreamer,
      onToggleWatch,
      watchAndFocusStreamByUserId,
      spatialAudioState,
      updateSharedSpatialAudioState,
      settingsUserId,
      channelId,
      roomSlug,
      voiceSessionId,
      isPreviewHidden,
      togglePreviewHidden,
      onToggleAlwaysShowStreamPreview,
    });
  }, [joined, isScreenSharing, isStreamingAudio, alwaysShowStreamPreview, currentScreenQuality, currentScreenSource, toggleMic, toggleDeafen, toggleScreenShare, onToggleStreamAudio, isMicOn, isDeafened, isCameraActive, hasCamera, hasMicrophone, toggleCamera, handleLeave, openScreenShareModal, onStreamStateUpdate, availableQualities, sfu, gridItems, streamThumbnails, watchedStreams, watchersByStreamer, onToggleWatch, watchAndFocusStreamByUserId, spatialAudioState, updateSharedSpatialAudioState, settingsUserId, channelId, roomSlug, voiceSessionId, isPreviewHidden, togglePreviewHidden, onToggleAlwaysShowStreamPreview]);


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
  const focusedWatchers = focusedItem?.type === "screen"
    && focusedItem.userId
    && (focusedItem.isLocal || !!watchedStreams[focusedItem.userId])
    ? (watchersByStreamer[focusedItem.userId] ?? [])
    : [];
  const wordleParticipants = useMemo(() => {
    const participants: Array<{ userId: string; name: string; avatar: string | null | undefined }> = [];
    for (const item of gridItems) {
      if (item.type === "avatar" || item.type === "camera") {
        participants.push({ userId: item.userId, name: item.name, avatar: item.avatar });
      }
    }
    return participants;
  }, [gridItems]);
  const activityStage = activeActivity?.activity === "wordle"
    ? (
        <WordleActivityStage
          sfu={sfu}
          channelId={channelId}
          localUserId={localUserId}
          participants={wordleParticipants}
        />
      )
    : activeActivity?.activity === "warp-rush"
      ? (
          <WarpRushActivityStage
            sfu={sfu}
            channelId={channelId}
            localUserId={localUserId}
            participants={wordleParticipants}
          />
        )
      : null;

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
    onOpenProfileUser,
    onOpenMessageUser,
    watchedStreams: watchedStreams,
    availableQualities: getAvailableStreamQualities(),
    onLeave: handleLeave,
    isMuted: !isMicOn,
    onToggleMute: toggleMic,
    isDeafened,
    onToggleDeafen: toggleDeafen,
    onChangeSource: () => setIsScreenModalOpen(true),
    watchersByStreamer,
    togglePreviewHidden,
    isPreviewHidden,
    alwaysShowStreamPreview,
    onToggleAlwaysShowStreamPreview,
    sfu,
    serverId,
    localUserId,
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
        focusedWatchers={focusedWatchers}
        currentScreenQuality={currentScreenQuality}
        sfu={sfu}
        showTextChat={showTextChat}
        onToggleTextChat={onToggleTextChat}
        onMenuClick={onMenuClick}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="flex-1 relative min-h-0 bg-rm-bg-primary overflow-hidden flex items-center justify-center">
          {activityStage ? (
            <div className="h-full w-full pt-16">
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),rgba(2,6,23,0.98)_55%)] px-6 text-center text-rm-text">
                    <div>
                      <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Loading Activity</div>
                      <div className="mt-3 text-2xl font-black">Preparing the stage...</div>
                    </div>
                  </div>
                }
              >
                {activityStage}
              </Suspense>
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
