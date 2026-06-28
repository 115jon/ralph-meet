
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import { VoiceDetailsPanel } from "@/components/voice/VoiceDetailsPanel";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import type { GridItem } from "@/components/voice/types";
import { useUptime } from "@/hooks/useUptime";
import { useVoiceStats } from "@/hooks/useVoiceStats";
import type { SFUClient } from "@/lib/sfu-client";
import type { ScreenShareSourceState } from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import { cn } from "@/lib/utils";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useRef, useState, lazy, Suspense } from "react";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import {
  Gamepad2,
  Monitor,
  MoreHorizontal,
  Phone,
  Radio,
  Share2,
  SignalHigh,
  Sparkles,
  Sticker,
  Video,
  VideoOff,
  Volume2,
  XCircle
} from "./Icons";
import { SpatialAudioPanel } from "./SpatialAudioPanel";

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));
const SoundboardPicker = lazy(() => import("@/components/chat/SoundboardPicker"));

const EMPTY_QUALITIES: string[] = [];

interface VoiceDashboardProps {
  serverName: string;
  voiceChannelName?: string;
  onVoiceDisconnect?: () => void;
  onVoiceNavigate?: () => void;
  isScreenSharing?: boolean;
  isStreamingAudio?: boolean;
  screenQuality?: string;
  currentScreenSource?: ScreenShareSourceState | null;
  availableQualities?: string[];
  onShareScreen?: () => void;
  onStopStreaming?: () => void;
  onToggleStreamAudio?: () => void;
  onChangeStreamSource?: () => void;
  onStreamQualityChange?: (quality: string) => void;
  isCameraActive?: boolean;
  hasCamera?: boolean;
  hasMicrophone?: boolean;
  onToggleCamera?: () => void;
  sfu?: SFUClient | null;
  voiceChannelId?: string | null;
  gridItems?: GridItem[];
  watchersByStreamer?: StreamWatchersByStreamer;
  spatialAudioState?: SharedSpatialAudioState;
  onUpdateSpatialAudioState?: (state: SharedSpatialAudioState) => void;
  participantCapabilities?: Record<string, { enabled?: boolean; highFidelity?: boolean }>;
  onOpenVoiceSettings?: () => void;
  voiceSettingsUserId?: string;
  localUserId?: string | null;
  serverId?: string | null;
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
}

export function VoiceDashboard({
  serverName,
  voiceChannelName,
  onVoiceDisconnect,
  onVoiceNavigate,
  isScreenSharing,
  isStreamingAudio,
  screenQuality,
  availableQualities = EMPTY_QUALITIES,
  onShareScreen,
  onStopStreaming,
  onToggleStreamAudio,
  onChangeStreamSource,
  onStreamQualityChange,
  isCameraActive,
  hasCamera,
  hasMicrophone,
  onToggleCamera,
  sfu = null,
  voiceChannelId,
  gridItems = [],
  watchersByStreamer = {},
  spatialAudioState,
  onUpdateSpatialAudioState,
  participantCapabilities,
  onOpenVoiceSettings,
  voiceSettingsUserId,
  localUserId,
  serverId,
  onOpenActivities,
  onOpenSoundboard,
}: VoiceDashboardProps) {
  const [isStreamMenuOpen, setIsStreamMenuOpen] = useState(false);
  const shouldRenderStreamMenu = useDelayUnmount(isStreamMenuOpen, 200);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const shouldRenderCameraModal = useDelayUnmount(isCameraModalOpen, 200);
  const [isVoiceDetailsOpen, setIsVoiceDetailsOpen] = useState(false);
  const shouldRenderVoiceDetails = useDelayUnmount(isVoiceDetailsOpen, 200);
  const [isSpatialOpen, setIsSpatialOpen] = useState(false);
  const shouldRenderSpatialOpen = useDelayUnmount(isSpatialOpen, 200);
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const shouldRenderStickerPicker = useDelayUnmount(isStickerPickerOpen, 200);
  const [isSoundboardPickerOpen, setIsSoundboardPickerOpen] = useState(false);
  const shouldRenderSoundboardPicker = useDelayUnmount(isSoundboardPickerOpen, 200);
  const stickerBtnRef = useRef<HTMLButtonElement>(null);
  const soundboardBtnRef = useRef<HTMLButtonElement>(null);

  const stats = useVoiceStats(sfu, true);
  const signalBtnRef = useRef<HTMLButtonElement>(null);
  const spatialBtnRef = useRef<HTMLButtonElement>(null);
  const settings = useVoiceSettingsStore((s) => s.getSettings(voiceSettingsUserId));
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const localStreamWatchers = localUserId ? (watchersByStreamer[localUserId] ?? []) : [];

  const vcStartedAt = useChatStore(s => voiceChannelId ? s.voiceChannelStartedAt[voiceChannelId] ?? null : null);
  const vcUptime = useUptime(vcStartedAt, !!voiceChannelId);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="p-2 space-y-2 animate-in slide-in-from-bottom-5 duration-300">
        {/* VOICE CONNECTED HEADER */}
        <div
          className="flex items-center justify-between px-2 pt-1 pb-2 cursor-pointer group/voice-status transition-colors rounded-lg mx-1 outline-none"
          onClick={onVoiceNavigate}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onVoiceNavigate?.();
            }
          }}
        >
          <div className="flex items-center gap-3 w-full">
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={signalBtnRef}
                    onClick={(e) => { e.stopPropagation(); setIsVoiceDetailsOpen(!isVoiceDetailsOpen); }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#23a559]/10 text-[#23a559] hover:bg-[#23a559]/20 transition-colors outline-none"
                  >
                    <SignalHigh size={18} className="animate-pulse" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p className="flex items-center gap-1.5">
                    {stats ? (
                      `Latency: ${stats.ping} ms`
                    ) : (
                      <><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#23a559] animate-pulse" />Connectingâ€¦</>
                    )}
                  </p>
                </TooltipContent>
              </Tooltip>
              <VoiceDetailsPanel
                sfu={sfu}
                isOpen={isVoiceDetailsOpen}
                onClose={() => setIsVoiceDetailsOpen(false)}
                triggerRef={signalBtnRef}
                channelName={voiceChannelName}
              />
            </div>
            {spatialAudioState && onUpdateSpatialAudioState && (
              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={spatialBtnRef}
                      onClick={(e) => { e.stopPropagation(); setIsSpatialOpen((v) => !v); }}
                      className={cn(
                        "p-1.5 text-rm-text-muted/60 hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all relative z-10 outline-none self-start mt-0.5 group",
                        spatialAudioState.enabled && settings.spatialAudioEnabled && settings.streamHighFidelity && "text-primary bg-primary/10"
                      )}
                    >
                      <Sparkles size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                    <p>Spatial Audio</p>
                  </TooltipContent>
                </Tooltip>
                <SpatialAudioPanel
                  isOpen={isSpatialOpen}
                  anchorRef={spatialBtnRef}
                  gridItems={gridItems}
                  spatialAudioState={spatialAudioState}
                  onUpdateSpatialAudioState={onUpdateSpatialAudioState}
                  localSpatialEnabled={settings.spatialAudioEnabled}
                  localHighFidelity={settings.streamHighFidelity}
                  localUserId={localUserId}
                  participantCapabilities={participantCapabilities}
                  onLocalSpatialEnabledChange={(enabled) => {
                    updateUserSettings((current) => ({
                      ...current,
                      spatialAudioEnabled: enabled,
                      streamHighFidelity: enabled ? true : current.streamHighFidelity,
                      echoCancellation: enabled ? false : current.echoCancellation,
                      noiseSuppression: enabled ? false : current.noiseSuppression,
                      autoSensitivity: enabled ? false : current.autoSensitivity,
                    }), voiceSettingsUserId);
                  }}
                  onOpenVoiceSettings={() => {
                    setIsSpatialOpen(false);
                    onOpenVoiceSettings?.();
                  }}
                  onClose={() => setIsSpatialOpen(false)}
                />
              </div>
            )}
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[14px] font-bold tracking-tight text-[#23a559] leading-tight flex items-baseline gap-1.5">
                Voice Connected
                {vcUptime && (
                  <span className="text-[11px] font-mono font-medium opacity-70">{vcUptime}</span>
                )}
              </span>
              <span className="text-[12px] font-medium text-rm-text-muted/80 truncate max-w-[140px] group-hover/voice-status:text-rm-text-muted">
                {voiceChannelName || 'General'} / {serverName}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => { e.stopPropagation(); onVoiceDisconnect?.(); }}
                  className="p-1.5 text-rm-text-muted/60 hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all relative z-10 outline-none self-start mt-0.5 group"
                >
                  <Phone size={20} strokeWidth={2.5} className="rotate-[135deg] group-hover:animate-wiggle" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                <p>Disconnect</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* STREAMING STATUS */}
        {isScreenSharing && (
          <div className="bg-rm-bg-elevated/50 rounded-lg p-2.5 border border-rm-border shadow-xl space-y-3 mx-1 mt-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center text-primary ring-1 ring-primary/20">
                <Monitor size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-black text-rm-text uppercase tracking-wider">Screen</span>
                  <span className="bg-primary text-[8px] font-black px-1 rounded text-primary-foreground shadow-sm uppercase leading-tight">Live</span>
                </div>
                <p className="text-[10px] text-rm-text-muted">Your screen share is active</p>
              </div>
            </div>

            {localStreamWatchers.length > 0 && (
              <StreamWatcherList watchers={localStreamWatchers} />
            )}

            <div className="flex gap-1.5 relative">
              <button
                onClick={onStopStreaming}
                className="flex-1 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded font-bold text-[10px] transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-primary/20"
              >
                <XCircle size={10} /> Stop Streaming
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsStreamMenuOpen(!isStreamMenuOpen)}
                  className={cn(
                    "p-1.5 h-full rounded transition-all outline-none",
                    isStreamMenuOpen ? "bg-rm-bg-elevated text-rm-text" : "bg-rm-bg-elevated/50 text-rm-text-muted hover:bg-rm-bg-elevated"
                  )}
                >
                  <MoreHorizontal size={14} />
                </button>

                {shouldRenderStreamMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-[60]"
                      onClick={() => setIsStreamMenuOpen(false)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setIsStreamMenuOpen(false); }}
                      role="button"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <div className={cn("absolute bottom-full right-0 mb-2 w-48 bg-rm-bg-elevated border border-rm-border rounded-xl shadow-2xl p-1.5 z-[70] backdrop-blur-xl origin-bottom-right", !isStreamMenuOpen ? "animate-out fade-out slide-out-to-bottom-2 zoom-out-95 duration-200" : "animate-in fade-in slide-in-from-bottom-2 duration-200")}>
                      <div className="px-3 py-1.5 border-b border-rm-border mb-1">
                        <p className="text-[10px] font-bold text-rm-text-muted uppercase tracking-widest">Stream Settings</p>
                      </div>
                      <button
                        onClick={() => { onChangeStreamSource?.(); setIsStreamMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <Share2 size={14} /> Change Source
                      </button>
                      <div className="h-[1px] bg-rm-border my-1" />
                      <button
                        onClick={() => { onToggleStreamAudio?.(); setIsStreamMenuOpen(false); }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-between outline-none",
                          isStreamingAudio ? "text-primary hover:bg-primary/10" : "text-rm-text-muted hover:bg-rm-bg-hover"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Volume2 size={14} /> Stream Audio
                        </span>
                        <div className={cn("w-2 h-2 rounded-full", isStreamingAudio ? "bg-primary shadow-[0_0_8px_var(--rm-glow)]" : "bg-rm-bg-active")} />
                      </button>
                      {availableQualities.length > 0 && (
                        <>
                          <div className="h-[1px] bg-rm-border my-1" />
                          <div className="px-3 py-1.5">
                            <p className="text-[9px] font-bold text-rm-text-muted/40 uppercase tracking-widest">Quality</p>
                          </div>
                          <div className="grid grid-cols-1 gap-0.5 max-h-48 overflow-y-auto custom-scrollbar">
                            {availableQualities.map(q => (
                              <button
                                key={q}
                                onClick={() => { onStreamQualityChange?.(q); setIsStreamMenuOpen(false); }}
                                className={cn(
                                  "w-full text-left px-3 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center justify-between group/q outline-none",
                                  screenQuality === q ? "bg-primary/10 text-primary" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <Monitor size={12} className={cn("transition-opacity", screenQuality === q ? "opacity-100" : "opacity-40")} />
                                  {q.replace('p', 'p ')}
                                </div>
                                {screenQuality === q && <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--rm-glow)]" />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ACTION BUTTON GRID */}
        <div className="px-3 pt-1 pb-2">
          <div className="flex items-center justify-between gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    if (isCameraActive) {
                      onToggleCamera?.();
                    } else {
                      if (settings?.alwaysPreviewVideo === false) {
                        onToggleCamera?.();
                      } else {
                        setIsCameraModalOpen(true);
                      }
                    }
                  }}
                  disabled={!hasCamera}
                  className={cn(
                    "flex flex-1 h-8 items-center justify-center rounded-[8px] transition-all outline-none border border-transparent group",
                    isCameraActive
                      ? "bg-rm-bg-hover text-rm-text"
                      : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover",
                    !hasCamera && "opacity-20 cursor-not-allowed grayscale"
                  )}
                >
                  {isCameraActive ? <Video size={18} className="group-hover:animate-wiggle" /> : <VideoOff size={18} className="group-hover:animate-wiggle" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                <p>{!hasCamera ? "No camera detected" : (isCameraActive ? "Turn Off Camera" : "Turn On Camera")}</p>
              </TooltipContent>
            </Tooltip>

            {/* Screen Share */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    if (isScreenSharing) {
                      onStopStreaming?.();
                    } else {
                      onShareScreen?.();
                    }
                  }}
                  className={cn(
                    "flex flex-1 h-8 items-center justify-center rounded-[8px] transition-all outline-none border border-transparent group",
                    isScreenSharing
                      ? "bg-[#23a559] text-white hover:bg-[#1f8b4c]"
                      : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                  )}
                >
                  <Monitor size={18} className="group-hover:animate-wiggle" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                <p>{isScreenSharing ? "Stop Streaming" : "Share Your Screen"}</p>
              </TooltipContent>
            </Tooltip>

            {/* Activities */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    onOpenActivities?.();
                  }}
                  className="flex flex-1 h-8 items-center justify-center rounded-[8px] transition-all outline-none bg-rm-bg-elevated/40 border border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover group"
                >
                  <Gamepad2 size={18} className="group-hover:animate-wiggle" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                <p>Start an Activity</p>
              </TooltipContent>
            </Tooltip>

            {/* Soundboard */}
            <div className="relative flex-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={soundboardBtnRef}
                    onClick={() => {
                      setIsSoundboardPickerOpen((v) => !v);
                    }}
                    className={cn(
                      "flex w-full h-8 items-center justify-center rounded-[8px] transition-all outline-none border group",
                      isSoundboardPickerOpen
                        ? "bg-[#5865f2]/20 border-[#5865f2]/40 text-[#5865f2]"
                        : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                    )}
                  >
                    <Radio size={18} className="group-hover:animate-wiggle" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>Open Soundboard</p>
                </TooltipContent>
              </Tooltip>
              {shouldRenderSoundboardPicker && (
                <Suspense fallback={null}>
                  <SoundboardPicker
                    onClose={() => setIsSoundboardPickerOpen(false)}
                    placement="top-start"
                    markerRef={soundboardBtnRef}
                    sfu={sfu}
                    serverId={serverId}
                    channelId={voiceChannelId}
                    isClosing={!isSoundboardPickerOpen}
                    localUserId={localUserId}
                  />
                </Suspense>
              )}
            </div>

            {/* GIF/Sticker Reactions — only shown when connected to voice */}
            {sfu && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="relative flex-1">
                    <button
                      ref={stickerBtnRef}
                      onClick={() => setIsStickerPickerOpen((v) => !v)}
                      className={cn(
                        "flex w-full h-8 items-center justify-center rounded-[8px] transition-all outline-none border group",
                        isStickerPickerOpen
                          ? "bg-[#5865f2]/20 border-[#5865f2]/40 text-[#5865f2]"
                          : "bg-rm-bg-elevated/40 border-white/5 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
                      )}
                    >
                      <Sticker size={18} className="group-hover:animate-wiggle" />
                    </button>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>GIF &amp; Sticker Reactions</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        <CameraSettingsModal
          isOpen={isCameraModalOpen}
          onClose={() => setIsCameraModalOpen(false)}
          isCameraActive={!!isCameraActive}
          onToggleCamera={onToggleCamera}
          settingsUserId={voiceSettingsUserId}
        />

        {/* GIF Picker in voice reaction mode */}
        {sfu && shouldRenderStickerPicker && (
          <Suspense fallback={null}>
            <GifPickerModal
              onClose={() => setIsStickerPickerOpen(false)}
              onSelect={async () => { /* no-op: voice mode handles send */ }}
              voiceMode={{ sfu }}
              markerRef={stickerBtnRef}
              isClosing={!isStickerPickerOpen}
            />
          </Suspense>
        )}

      </div>
    </TooltipProvider>
  );
}
