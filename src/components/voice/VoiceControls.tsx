import { cn } from "@/lib/utils";
import { Headphones, Maximize2, Mic, MicOff, Minimize, Monitor, MonitorX, Phone, Sparkles, Video, VideoOff, X } from "../chat/Icons";

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
  isFullscreen: boolean;
  toggleFs: () => void;
  showMembers: boolean;
  setShowMembers: (val: boolean) => void;
  ChevronUp: React.ElementType;
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
  isFullscreen,
  toggleFs,
  showMembers,
  setShowMembers,
  ChevronUp,
}: VoiceControlsProps) {
  return (
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
  );
}
