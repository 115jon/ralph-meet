import RoomSettingsModal from "@/components/RoomSettingsModal";
import {
  DemoRoomChatPanel,
  DemoUploadBlockerModal,
} from "@/components/DemoRoomChatPanel";
import { AudioInteractionModal } from "@/components/voice/AudioInteractionModal";
import { StreamWatcherList } from "@/components/voice/StreamWatcherList";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { VoiceGrid } from "@/components/voice/VoiceGrid";
import { VoiceHeader } from "@/components/voice/VoiceHeader";
import { MembersTray, VoiceStage } from "@/components/voice/VoiceStage";
import {
  PublicBody,
  PublicFrame,
  PublicKicker,
  PublicTitle,
} from "@/components/auth/PublicFrame";
import { Button } from "@/components/ui/button";
import { FieldPlate, Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/IconButton";
import { EmptyState } from "@/components/ui/empty-state";
import { Num } from "@/components/ui/num";
import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import { copyRoomLink } from "@/lib/room-links";
import { getRoomPreflightWarnings } from "@/lib/room-preflight";
import { resumeSoundContext } from "@/lib/sounds";
import {
  getLocalScreenStreamWatchers,
  type StreamWatcherIdentity,
} from "@/lib/stream-watchers";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Icon } from "@/components/ui/icon";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";

const UnifiedScreenShareModal = lazy(() =>
  import("@/components/UnifiedScreenShareModal").then((mod) => ({
    default: mod.UnifiedScreenShareModal,
  })),
);

export default function RoomPageClient() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const navigate = useNavigate();

  // Guest name state — stored in sessionStorage for persistence across refreshes
  const [guestState, setGuestState] = useState({
    name: "",
    submitted: false,
  });
  const [preflightWarnings, setPreflightWarnings] = useState<string[]>([]);
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

  useEffect(() => {
    let cancelled = false;

    async function checkRoomDevices() {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices?.();
        if (!cancelled && devices) {
          setPreflightWarnings(getRoomPreflightWarnings(devices));
        }
      } catch {
        if (!cancelled) {
          setPreflightWarnings(["No microphone detected"]);
        }
      }
    }

    if (!guestState.submitted) {
      void checkRoomDevices();
    }

    return () => {
      cancelled = true;
    };
  }, [guestState.submitted]);

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
      <RoomJoinForm
        slug={slug}
        name={guestState.name}
        onNameChange={(name) => setGuestState({ ...guestState, name })}
        onSubmit={handleNameSubmit}
        warnings={preflightWarnings}
        inputRef={inputRef}
      />
    );
  }

  // ── Voice room (after name submitted) ──────────────────────────────────

  return (
    <RoomVoiceView
      slug={slug}
      guestName={guestState.name}
      onLeaveToHome={() => navigate({ to: "/" })}
      onSignIn={() => navigate({ to: "/sign-in" })}
    />
  );
}

/** Guest name entry before joining a room (exported for the UI fixtures). */
export function RoomJoinForm({
  slug,
  name,
  onNameChange,
  onSubmit,
  warnings,
  inputRef,
}: {
  slug: string;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.SubmitEvent) => void;
  warnings: string[];
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const nameId = useId();
  return (
    <PublicFrame>
      <PublicKicker>Meeting room</PublicKicker>
      <PublicTitle size="display" className="break-words">
        Join {slug}
      </PublicTitle>
      <PublicBody size="lead">Pick the name the room will see.</PublicBody>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        {warnings.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-[2px] bg-warning-tint px-3 py-3 text-ui-sm text-warning-ink"
          >
            <Icon name="warning" size="sm" className="mt-0.5 shrink-0" />
            <span className="text-pretty">
              {warnings[0]}. You can still join, then check input settings from
              the call controls.
            </span>
          </div>
        )}
        <FieldPlate label="Your name" htmlFor={nameId}>
          <Input
            ref={inputRef}
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Ada Lovelace"
            inputSize="lg"
            className="pointer-coarse:min-h-11"
            autoComplete="name"
            required
          />
        </FieldPlate>
        <Button
          type="submit"
          size="lg"
          disabled={!name.trim()}
          className="w-full"
        >
          Join
        </Button>
      </form>
    </PublicFrame>
  );
}

/** The wait between submitting a name and joining (exported for fixtures). */
export function RoomConnecting({ slug }: { slug: string }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-ply-0">
      <EmptyState loading title={`Connecting to ${slug}…`} />
    </div>
  );
}

// ── Room voice view (the shared voice stage, header and dock) ─────────────

/** Header extras for the room: copy the invite link, the watchers, the count. */
export function RoomMeta({
  slug,
  focused: _focused,
  gridItemsCount,
  localScreenWatchers,
}: {
  slug: string;
  focused: boolean;
  gridItemsCount: number;
  localScreenWatchers: StreamWatcherIdentity[];
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const handleCopyRoomLink = async () => {
    try {
      await copyRoomLink(slug);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  const divider = cn("hidden h-4 w-px shrink-0 md:block", "bg-line-strong");

  return (
    <>
      <IconButton
        icon={copyState === "copied" ? "check" : "link"}
        size={32}
        variant="plain"
        tooltip={
          copyState === "copied"
            ? "Link copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy room link"
        }
        className={cn(
          copyState === "copied"
            ? "text-success-ink"
            : copyState === "failed"
              ? "text-danger-ink"
              : "text-ink-3 pointer-fine:hover:text-ink-1",
        )}
        onClick={handleCopyRoomLink}
      />
      {localScreenWatchers.length > 0 && (
        <>
          <div aria-hidden className={divider} />
          <StreamWatcherList
            watchers={localScreenWatchers}
            variant="inline"
            className="hidden max-w-[min(38vw,18rem)] md:flex"
          />
        </>
      )}
      <div aria-hidden className={divider} />
      <span className="hidden items-center gap-1 whitespace-nowrap text-ui-xs text-ink-3 md:inline-flex">
        <Num>{gridItemsCount}</Num> in room
      </span>
    </>
  );
}

function RoomVoiceView({
  slug,
  guestName,
  onLeaveToHome,
  onSignIn,
}: {
  slug: string;
  guestName: string;
  onLeaveToHome: () => void;
  onSignIn: () => void;
}) {
  const {
    joined,
    isScreenSharing,
    isStreamingAudio,
    currentScreenQuality,
    currentScreenSource,
    connectionState,
    focusedId,
    setFocusedId,
    watchedStreams,
    watchersByStreamer,
    streamThumbnails,
    gridItems,
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
    hasMicrophone,
    hasCamera,
    sfu,
    settingsUserId,
    audioStalled,
    togglePreviewHidden,
    isPreviewHidden,
    alwaysShowStreamPreview,
    onToggleAlwaysShowStreamPreview,
  } = useVoiceChannel({
    mode: "room",
    roomSlug: slug,
    guestName,
    onJoined: () => {},
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
  const [showUploadBlocker, setShowUploadBlocker] = useState(false);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const availableQualities = useMemo(() => getAvailableStreamQualities(), []);
  const localScreenWatchers = useMemo(
    () => getLocalScreenStreamWatchers(gridItems, watchersByStreamer),
    [gridItems, watchersByStreamer],
  );

  useEffect(() => {
    const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFs);
    return () => document.removeEventListener("fullscreenchange", handleFs);
  }, []);

  const toggleFs = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      if (!document.fullscreenEnabled || !container.requestFullscreen) return;
      container
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => setIsFullscreen(false));
    } else {
      void document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const hasDraggedFiles = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes("Files") ||
    event.dataTransfer.files.length > 0;

  const openUploadBlocker = () => setShowUploadBlocker(true);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsFileDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    setIsFileDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsFileDragging(false);
    openUploadBlocker();
  };

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
    watchersByStreamer,
    togglePreviewHidden,
    isPreviewHidden,
    alwaysShowStreamPreview,
    onToggleAlwaysShowStreamPreview,
    sfu,
  };

  if (!joined) return <RoomConnecting slug={slug} />;

  const focusedItem = gridItems.find((item) => item.id === focusedId);

  return (
    <VoiceStage
      ref={containerRef}
      className="h-full"
      header={
        <VoiceHeader
          channelName={slug}
          titleIcon="voiceChannel"
          connectionState={connectionState}
          joined={joined}
          focusedItem={focusedItem ?? null}
          currentScreenQuality={currentScreenQuality}
          sfu={sfu}
          onToggleTextChat={undefined}
          meta={
            <RoomMeta
              slug={slug}
              focused={!!focusedItem}
              gridItemsCount={gridItems.length}
              localScreenWatchers={localScreenWatchers}
            />
          }
        />
      }
      tray={
        focusedId && showMembers ? (
          <MembersTray
            items={gridItems}
            focusedId={focusedId}
            onFocus={setFocusedId}
            globalDeafened={isDeafened}
            watchedStreams={watchedStreams}
            streamThumbnails={streamThumbnails}
            voiceActions={voiceActions}
          />
        ) : null
      }
      dock={
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
          isFullscreen={isFullscreen}
          toggleFs={toggleFs}
          showMembers={showMembers}
          setShowMembers={setShowMembers}
          onOpenSettings={() => setIsSettingsOpen(true)}
          settingsUserId={settingsUserId}
          sfu={sfu}
          showMicDeafen
        />
      }
    >
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isFileDragging && (
          <div className="pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-xl border border-dashed border-accent-ink bg-scrim">
            <div className="rounded-lg border border-line bg-ply-3 px-4 py-3 text-center shadow-float">
              <p className="text-ui-sm font-semibold text-ink-1">
                Uploads unlock in the full app
              </p>
              <p className="mt-1 text-ui-xs text-ink-2">
                Drop to see how to sign in. GIFs still work here.
              </p>
            </div>
          </div>
        )}
        {audioStalled && isMicOn && (
          <div
            role="alert"
            className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-line bg-danger-tint px-4 text-ui-xs text-danger-ink"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="mic" state="off" size="sm" className="shrink-0" />
              <span className="text-pretty">
                We can't hear you. Your microphone isn't picking up any sound.
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-6"
              onClick={() => setIsSettingsOpen(true)}
            >
              Check settings
            </Button>
          </div>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
          <DemoRoomChatPanel
            sfu={sfu}
            guestName={guestName}
            onUploadBlocked={openUploadBlocker}
            className="h-[42%] shrink-0 md:h-auto"
          />
        </div>
      </div>

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
          availableQualities={availableQualities}
        />
      </Suspense>

      <AudioInteractionModal
        open={audioBlocked}
        onInteract={() => {
          sfu?.resumeAudioContext();
          resumeSoundContext();
          setAudioBlocked(false);
        }}
        onClose={() => setAudioBlocked(false)}
      />

      <RoomSettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settingsUserId={settingsUserId}
      />
      <DemoUploadBlockerModal
        open={showUploadBlocker}
        onClose={() => setShowUploadBlocker(false)}
        onSignIn={onSignIn}
      />
    </VoiceStage>
  );
}
