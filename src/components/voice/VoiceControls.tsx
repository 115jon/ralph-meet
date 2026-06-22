import { cn } from "@/lib/utils";
import { lazy, Suspense, useRef, useState } from "react";
import type { SFUClient } from "@/lib/sfu-client";
import { CameraSettingsModal } from "../CameraSettingsModal";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Gamepad2, Headphones, Maximize2, MessageSquare, Mic, MicOff, Minimize, Monitor, MonitorX, Phone, Sticker, Video, VideoOff, X } from "../chat/Icons";

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));


interface VoiceControlsProps {
  hasMicrophone: boolean;
  isMicOn: boolean;
  toggleMic: () => void;
  isDeafened: boolean;
  toggleDeafen: () => void;
  hasCamera: boolean;
  isCameraOn: boolean;
  toggleCamera: () => void;
  isScreenSharing: boolean;
  toggleScreenShare: () => void;
  setIsScreenModalOpen: (val: boolean) => void;
  focusedItem: any;
  setFocusedId: (id: string | null) => void;
  handleLeave: () => void;
  activeActivity?: "wordle" | null;
  leaveActivity?: () => void;
  isFullscreen: boolean;
  toggleFs: () => void;
  showMembers: boolean;
  setShowMembers: (val: boolean) => void;
  ChevronUp: React.ElementType;
  variant?: "default" | "call";
  hideExtraControls?: boolean;
  isChatHidden?: boolean;
  toggleChatHidden?: () => void;
  onOpenActivities?: () => void;
  settingsUserId?: string;
  sfu?: SFUClient | null;
}

export function VoiceControls({
  hasMicrophone,
  isMicOn,
  toggleMic,
  isDeafened,
  toggleDeafen,
  hasCamera,
  isCameraOn,
  toggleCamera,
  isScreenSharing,
  toggleScreenShare,
  setIsScreenModalOpen,
  focusedItem,
  setFocusedId,
  handleLeave,
  activeActivity,
  leaveActivity,
  isFullscreen,
  toggleFs,
  showMembers,
  setShowMembers,
  ChevronUp,
  variant = "default",
  hideExtraControls = false,
  isChatHidden,
  toggleChatHidden,
  onOpenActivities,
  settingsUserId,
  sfu = null,
}: VoiceControlsProps) {
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isStickerOpen, setIsStickerOpen] = useState(false);
  const stickerBtnRef = useRef<HTMLButtonElement>(null);
  
  const settings = useVoiceSettingsStore((s) => s.getSettings(settingsUserId));

  const isCall = variant === "call";
  const pillBgClass = isCall ? "bg-slate-100 dark:bg-[#070709] border-slate-200 dark:border-white/10 shadow-2xl" : "bg-rm-bg-surface border-rm-border shadow-2xl";
  const btnBaseClass = isCall ? "text-slate-600 dark:text-white/90 bg-transparent hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white" : "text-rm-text-primary bg-transparent hover:bg-rm-bg-hover hover:text-rm-text";
  const btnFilledClass = isCall ? "bg-slate-200 dark:bg-white/5 text-slate-700 dark:text-white/90 hover:bg-slate-300 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white" : "bg-rm-bg-hover/70 text-rm-text-primary hover:bg-rm-bg-hover hover:text-rm-text";

  return (
    <>
    <div className={cn(
      "flex items-center overflow-x-auto scrollbar-none gap-2",
      variant === "default" ? "h-[72px] justify-between px-2 md:px-6 bg-rm-bg-elevated/40" : "h-auto py-2 justify-between bg-transparent"
    )}>
      <div className={cn("hidden md:flex flex-1 items-center gap-2", hideExtraControls && "invisible")}>
        {isCall && !isFullscreen && (
          <div className={cn("flex items-center p-1 rounded-2xl border", pillBgClass)}>
            <button
              onClick={toggleChatHidden}
              className={cn("w-10 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none", btnBaseClass)}
              title={isChatHidden ? "Show Chat" : "Hide Chat"}
            >
              <MessageSquare size={20} className={cn(!isChatHidden && (isCall ? "fill-slate-300 dark:fill-white/20" : "fill-rm-text/20"))} />
            </button>
          </div>
        )}
      </div>

      <div className={cn("flex items-center gap-2 md:gap-3 shrink-0 mx-auto")}>
        <div className={cn("flex items-center gap-0.5 md:gap-1 p-1 rounded-2xl border shrink-0", pillBgClass)}>
          <button
            title={!hasMicrophone ? "No microphone detected" : isMicOn ? "Mute" : "Unmute"}
            disabled={!hasMicrophone}
            onClick={toggleMic}
            className={cn(
              "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
              (!isMicOn || !hasMicrophone) ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20" : btnFilledClass,
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
              isDeafened ? "bg-destructive text-destructive-foreground" : btnFilledClass
            )}
          >
            <Headphones size={20} className={isDeafened ? "text-destructive-foreground" : ""} />
          </button>

          <button
            title={!hasCamera ? "No camera detected" : isCameraOn ? "Stop Camera" : "Start Camera"}
            disabled={!hasCamera}
            onClick={() => {
              if (isCameraOn) {
                toggleCamera();
              } else {
                if (settings?.alwaysPreviewVideo === false) {
                  toggleCamera();
                } else {
                  setIsCameraModalOpen(true);
                }
              }
            }}
            className={cn(
              "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
              isCameraOn ? (isCall ? "bg-slate-900 dark:bg-white text-white dark:text-[#070709] shadow-lg" : "bg-rm-text text-rm-bg-surface shadow-lg") : btnFilledClass,
              !hasCamera && "opacity-50 cursor-not-allowed grayscale"
            )}
          >
            {(isCameraOn) ? <Video size={20} /> : <VideoOff size={20} />}
          </button>

          <div className={cn("w-px h-6 mx-1", isCall ? "bg-slate-300 dark:bg-white/10" : "bg-rm-border")} />

          <button
            title={isScreenSharing ? "Stop Stream" : "Share Screen"}
            onClick={() => {
              if (isScreenSharing) toggleScreenShare();
              else setIsScreenModalOpen(true);
            }}
            className={cn(
              "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
              isScreenSharing ? "bg-primary text-primary-foreground" : btnFilledClass
            )}
          >
            {isScreenSharing ? <X size={20} className="text-primary-foreground" /> : <Monitor size={20} />}
          </button>
          <div className={cn("hidden md:block w-px h-6 mx-1", isCall ? "bg-slate-300 dark:bg-white/10" : "bg-rm-border")} />
          <button
            title="Activities"
            onClick={onOpenActivities}
            className={cn("w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none", btnFilledClass)}
          >
            <Gamepad2 size={20} />
          </button>

          {/* GIF/Sticker Reactions — only visible when SFU is connected */}
          {sfu && (
            <div className="relative">
              <button
                ref={stickerBtnRef}
                title="GIF & Sticker Reactions"
                onClick={() => setIsStickerOpen((v) => !v)}
                className={cn(
                  "w-12 h-10 md:w-12 md:h-10 rounded-xl flex items-center justify-center transition-all outline-none",
                  isStickerOpen
                    ? (isCall ? "bg-[#5865f2] text-white" : "bg-[#5865f2]/20 text-[#5865f2]")
                    : btnFilledClass
                )}
              >
                <Sticker size={20} />
              </button>
            </div>
          )}


          <div className={cn("w-px h-6 mx-1", isCall ? "bg-slate-300 dark:bg-white/10" : "bg-rm-border")} />

          <button
            title={activeActivity ? "Leave Activity" : focusedItem?.isStreaming ? "Stop Watching" : "Disconnect"}
            onClick={activeActivity ? leaveActivity : focusedItem?.isStreaming ? () => setFocusedId(null) : handleLeave}
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
                activeActivity ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-75 rotate-45"
              )}>
                <X size={20} className="text-destructive-foreground" />
              </div>
              <div className={cn(
                "absolute inset-0 transition-all duration-300 ease-in-out flex items-center justify-center",
                !focusedItem?.isStreaming && !activeActivity ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-75 -rotate-45"
              )}>
                <Phone size={20} className="text-destructive-foreground" />
              </div>
            </div>
          </button>
        </div>
      </div>
      <div className={cn("flex-1 flex items-center justify-end gap-1 md:gap-3 shrink-0", hideExtraControls && "invisible")}>
        <div className={cn("flex items-center gap-0.5 md:gap-1 p-1 rounded-2xl border", pillBgClass)}>
          <button
            onClick={toggleFs}
            className={cn("w-10 h-10 md:w-12 md:h-10 flex items-center justify-center rounded-xl transition-all outline-none", btnBaseClass)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize2 size={20} />}
          </button>
          {!isCall && (
            <button
              onClick={() => setShowMembers(!showMembers)}
              className={cn(
                "w-10 h-10 md:w-12 md:h-10 flex items-center justify-center rounded-xl transition-all outline-none",
                showMembers ? "text-rm-text bg-rm-bg-active" : btnBaseClass
              )}
              title={showMembers ? "Hide Members" : "Show Members"}
            >
              <ChevronUp className={cn("transition-transform", !showMembers && "rotate-180")} size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
    <CameraSettingsModal
      isOpen={isCameraModalOpen}
      onClose={() => setIsCameraModalOpen(false)}
      isCameraActive={isCameraOn}
      onToggleCamera={toggleCamera}
      settingsUserId={settingsUserId}
    />
    {/* GIF Picker in voice reaction mode */}
    {sfu && isStickerOpen && (
      <Suspense fallback={null}>
        <GifPickerModal
          onClose={() => setIsStickerOpen(false)}
          onSelect={async () => { /* no-op: voice mode handles send */ }}
          voiceMode={{ sfu }}
        />
      </Suspense>
    )}
    </>
  );
}
