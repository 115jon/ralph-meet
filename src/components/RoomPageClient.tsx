import RoomSettingsModal from "@/components/RoomSettingsModal";
import { AudioInteractionModal } from "@/components/voice/AudioInteractionModal";
import { ParticipantCard } from "@/components/voice/ParticipantCard";
import { VoiceGrid } from "@/components/voice/VoiceGrid";
import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import { resumeSoundContext } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  Camera,
  CameraOff,
  ChevronUp,
  Headphones,
  LogOut,
  Maximize2,
  Mic,
  MicOff,
  Minimize,
  Monitor,
  Radio,
  Settings,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

const UnifiedScreenShareModal = lazy(() =>
  import("@/components/UnifiedScreenShareModal").then((mod) => ({ default: mod.UnifiedScreenShareModal }))
);

export default function RoomPageClient() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate();

  // Guest name state — stored in sessionStorage for persistence across refreshes
  const [guestState, setGuestState] = useState({
    name: "",
    submitted: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let t: NodeJS.Timeout;
    const stored = sessionStorage.getItem("room-guest-name");
    if (stored) {
      t = setTimeout(() => {
        setGuestState({ name: stored, submitted: true });
      }, 0);
    } else {
      inputRef.current?.focus();
    }
    return () => clearTimeout(t);
  }, []);

  const handleNameSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    const trimmed = guestState.name.trim();
    if (!trimmed) return;
    sessionStorage.setItem("room-guest-name", trimmed);
    setGuestState({ name: trimmed, submitted: true });
  };

  // ── Name entry screen ──────────────────────────────────────────────────

  if (!guestState.submitted) {
    return (
      <div className="flex h-full items-center justify-center bg-rm-bg-primary px-6">
        <div className="pointer-events-none absolute -top-48 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.15)_0%,rgba(147,51,234,0.06)_40%,transparent_70%)] blur-xl" />
        <div className="z-10 w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500/20 to-purple-500/20 shadow-[0_0_40px_rgba(99,102,241,0.15)] ring-1 ring-rm-border">
              <Radio className="h-8 w-8 text-indigo-400" />
            </div>
            <h1 className="text-2xl font-extrabold text-rm-text">Join Meeting</h1>
            <p className="text-center text-sm text-rm-text-muted">
              Room: <span className="font-semibold text-rm-text">{slug}</span>
            </p>
          </div>

          <form onSubmit={handleNameSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-xs font-semibold text-rm-text-muted">
                Your Name
              </label>
              <input
                ref={inputRef}
                id="name"
                type="text"
                value={guestState.name}
                onChange={(e) => setGuestState({ ...guestState, name: e.target.value })}
                placeholder="Enter your name"
                className="w-full rounded-xl border border-rm-border bg-rm-bg-elevated px-4 py-3 text-rm-text outline-none transition-all placeholder:text-rm-text-muted/40 focus:border-indigo-500/30 focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="off"
                required
              />
            </div>
            <button
              type="submit"
              disabled={!guestState.name.trim()}
              className="w-full rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 py-3 text-base font-bold text-primary-foreground shadow-lg shadow-indigo-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:from-indigo-500 hover:to-purple-500 hover:shadow-xl disabled:opacity-40"
            >
              Join Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Voice room (after name submitted) ──────────────────────────────────

  return <RoomVoiceView slug={slug} guestName={guestState.name} onLeaveToHome={() => navigate({ to: "/" })} />;
}

// ── Room voice view (uses modern voice components) ───────────────────────

function ControlsBar({
  hasMicrophone, isMicOn, toggleMic,
  isDeafened, toggleDeafen,
  hasCamera, isCameraOn, toggleCamera,
  isScreenSharing, toggleScreenShare, setIsScreenModalOpen,
  handleLeave,
  toggleFs, isFullscreen,
  setIsSettingsOpen,
  focusedId, showMembers, setShowMembers
}: any) {
  return (
    <div className="h-[72px] flex items-center justify-between px-6 bg-rm-bg-elevated/40">
      <div className="flex-1 flex items-center" />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-rm-bg-surface p-1 rounded-2xl border border-rm-border shadow-2xl">
          <button
            title={!hasMicrophone ? "No microphone detected" : isMicOn ? "Mute" : "Unmute"}
            disabled={!hasMicrophone}
            onClick={toggleMic}
            className={cn(
              "w-12 h-10 rounded-xl flex items-center justify-center transition-all outline-none",
              (!isMicOn || !hasMicrophone) ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text",
              !hasMicrophone && "cursor-not-allowed"
            )}
          >
            {(!isMicOn || !hasMicrophone) ? <MicOff className="h-5 w-5 text-destructive-foreground" /> : <Mic className="h-5 w-5" />}
          </button>

          <button
            title={isDeafened ? "Undeafen" : "Deafen"}
            onClick={toggleDeafen}
            className={cn(
              "w-12 h-10 rounded-xl flex items-center justify-center transition-all outline-none",
              isDeafened ? "bg-destructive text-destructive-foreground" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
            )}
          >
            <Headphones className={cn("h-5 w-5", isDeafened && "text-destructive-foreground")} />
          </button>

          <button
            title={!hasCamera ? "No camera detected" : isCameraOn ? "Stop Camera" : "Start Camera"}
            disabled={!hasCamera}
            onClick={toggleCamera}
            className={cn(
              "w-12 h-10 rounded-xl flex items-center justify-center transition-all outline-none",
              isCameraOn ? "bg-rm-text text-rm-bg-surface shadow-lg" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text",
              !hasCamera && "opacity-50 cursor-not-allowed grayscale"
            )}
          >
            {isCameraOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
          </button>

          <div className="w-px h-6 bg-rm-border mx-1" />

          <button
            title={isScreenSharing ? "Stop Stream" : "Share Screen"}
            onClick={() => {
              if (isScreenSharing) toggleScreenShare();
              else setIsScreenModalOpen(true);
            }}
            className={cn(
              "w-12 h-10 rounded-xl flex items-center justify-center transition-all outline-none",
              isScreenSharing ? "bg-primary text-primary-foreground" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
            )}
          >
            {isScreenSharing ? <X className="h-5 w-5 text-primary-foreground" /> : <Monitor className="h-5 w-5" />}
          </button>

          <div className="w-px h-6 bg-rm-border mx-1" />

          <button
            title="Leave"
            onClick={handleLeave}
            className="w-12 h-10 flex items-center justify-center bg-destructive text-destructive-foreground rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all shrink-0"
          >
            <LogOut className="h-5 w-5 text-destructive-foreground" />
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-end gap-3">
        <button
          onClick={toggleFs}
          className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-xl transition-all outline-none"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
        </button>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-xl transition-all outline-none"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
        {focusedId && (
          <button
            onClick={() => setShowMembers(!showMembers)}
            className={cn(
              "p-2 rounded-xl transition-all outline-none",
              showMembers ? "text-rm-text bg-rm-bg-active" : "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover"
            )}
            title={showMembers ? "Hide Members" : "Show Members"}
          >
            <ChevronUp className={cn("h-5 w-5 transition-transform", !showMembers && "rotate-180")} />
          </button>
        )}
      </div>
    </div>
  );
}

function RoomHeader({ slug, connectionState, joined, focusedId, gridItemsCount }: any) {
  return (
    <div
      className={cn(
        "absolute top-0 inset-x-0 flex items-center justify-between px-6 z-100 pointer-events-none",
        focusedId ? "bg-linear-to-b from-rm-bg-primary/80 to-transparent" : "bg-rm-bg-primary/20"
      )}
      style={{ paddingTop: 'var(--safe-area-top, 0px)', height: 'calc(3.5rem + var(--safe-area-top, 0px))' }}
    >
      <div className="flex items-center gap-3 pointer-events-auto">
        <Radio className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-bold text-rm-text tracking-tight">{slug}</span>
        <div className="h-4 w-px bg-rm-border" />
        <span className="text-[10px] font-black text-rm-text-muted/40 uppercase tracking-widest">
          {connectionState === "connected" || joined ? "Stable" : connectionState === "new" ? "Connecting…" : connectionState}
        </span>
        <div className="h-4 w-px bg-rm-border" />
        <span className="text-xs text-rm-text-muted">{gridItemsCount} in room</span>
      </div>
      <div className="pointer-events-auto" />
    </div>
  );
}

function RoomVoiceView({
  slug,
  guestName,
  onLeaveToHome,
}: {
  slug: string;
  guestName: string;
  onLeaveToHome: () => void;
}) {
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
    sfu,
    settingsUserId,
    audioStalled,
  } = useVoiceChannel({
    mode: "room",
    roomSlug: slug,
    guestName,
    onJoined: () => { },
    onLeft: () => {
      sessionStorage.removeItem("room-guest-name");
      onLeaveToHome();
    },
    autoJoin: true,
  });

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const availableQualities = useMemo(() => getAvailableStreamQualities(), []);

  useEffect(() => {
    const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFs);
    return () => document.removeEventListener("fullscreenchange", handleFs);
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

  const voiceActions = {
    onToggleScreenShare: toggleScreenShare,
    isCurrentUserStreaming: isScreenSharing,
    currentScreenQuality,
    currentScreenSource,
    isStreamingAudio,
    onToggleStreamAudio,
    onToggleWatch,
    watchedStreams,
    availableQualities,
    onLeave: handleLeave,
    isMuted: !isMicOn,
    onToggleMute: toggleMic,
    isDeafened,
    onToggleDeafen: toggleDeafen,
    onChangeSource: () => setIsScreenModalOpen(true),
    sfu,
  };

  if (!joined) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-rm-bg-primary gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500/20 to-purple-500/20 ring-1 ring-rm-border animate-pulse">
          <Radio className="h-8 w-8 text-indigo-400" />
        </div>
        <span className="text-sm font-semibold text-rm-text-muted">Connecting to {slug}…</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-rm-bg-primary relative overflow-hidden">
      <RoomHeader
        slug={slug}
        connectionState={connectionState}
        joined={joined}
        focusedId={focusedId}
        gridItemsCount={gridItems.length}
      />

      <div className="flex-1 flex flex-col min-h-0 relative">
        {audioStalled && isMicOn && (
          <div className="z-50 bg-destructive text-destructive-foreground px-4 py-3 flex items-center justify-between text-sm font-medium shadow-md shrink-0">
            <div className="flex items-center gap-2">
              <MicOff className="h-4 w-4 shrink-0" />
              <span>We can't hear you! Your microphone isn't detecting any sound.</span>
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="bg-destructive-foreground text-destructive px-3 py-1.5 rounded-md text-xs font-bold hover:brightness-110 active:scale-95 transition-all outline-none"
            >
              Check Settings
            </button>
          </div>
        )}
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

        <div className="shrink-0 bg-rm-bg-surface border-t border-rm-border z-20 relative">
          {focusedId && showMembers && (
            <div className="p-4 bg-rm-bg-primary/20 backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-300 w-full overflow-hidden border-b border-rm-border">
              <div className="flex items-center gap-4 w-full overflow-x-auto no-scrollbar px-6 justify-start sm:justify-center" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {gridItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "w-44 sm:w-52 aspect-video shrink-0 transition-all duration-300 py-2",
                      focusedId === item.id ? "" : "opacity-70 hover:opacity-100"
                    )}
                  >
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

          <ControlsBar
            hasMicrophone={hasMicrophone} isMicOn={isMicOn} toggleMic={toggleMic}
            isDeafened={isDeafened} toggleDeafen={toggleDeafen}
            hasCamera={hasCamera} isCameraOn={isCameraOn} toggleCamera={toggleCamera}
            isScreenSharing={isScreenSharing} toggleScreenShare={toggleScreenShare} setIsScreenModalOpen={setIsScreenModalOpen}
            handleLeave={handleLeave}
            toggleFs={toggleFs} isFullscreen={isFullscreen}
            setIsSettingsOpen={setIsSettingsOpen}
            focusedId={focusedId} showMembers={showMembers} setShowMembers={setShowMembers}
          />
        </div>
      </div>

      <Suspense fallback={null}>
        <UnifiedScreenShareModal
          isOpen={isScreenModalOpen}
          onClose={() => setIsScreenModalOpen(false)}
          onStart={({ quality, withAudio, sourceId, captureId, sourceName, sourceKind }) => {
            toggleScreenShare({
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
          availableQualities={availableQualities}
        />
      </Suspense>

      {
        audioBlocked && (
          <AudioInteractionModal
            onInteract={() => {
              sfu?.resumeAudioContext();
              resumeSoundContext();
              setAudioBlocked(false);
            }}
            onClose={() => setAudioBlocked(false)}
          />
        )
      }

      {
        isSettingsOpen && (
          <RoomSettingsModal
            onClose={() => setIsSettingsOpen(false)}
            settingsUserId={settingsUserId}
          />
        )
      }
    </div >
  );
}
