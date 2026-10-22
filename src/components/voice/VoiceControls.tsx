import { cn } from "@/lib/utils";
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { SFUClient } from "@/lib/sfu-client";
import { handleVoiceCameraToggle } from "@/lib/voice/camera-toggle";
import type { ActivityType } from "@/stores/useActivityStore";
import { CameraSettingsModal } from "../CameraSettingsModal";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Icon } from "@/components/ui/icon";

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));

/*
 * Quiet Pro dock recipe. Rest = neutral tint; mic/deafen "muted" = red tint
 * (never the solid Leave red); camera/screen share "live" = the only accent
 * fill; Leave/disconnect = the only solid destructive control.
 */
const DOCK_GROUP =
  "flex items-center gap-1 rounded-xl border border-rm-border bg-rm-bg-surface p-1";
const DOCK_DIVIDER = "mx-0.5 h-6 w-px shrink-0 bg-rm-border";
const DOCK_BTN = cn(
  PRESS,
  HIT,
  DISABLED,
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg outline-none",
);
const DOCK_REST = "bg-rm-tint-1 text-rm-text";
const DOCK_OPEN = "bg-rm-tint-3 text-rm-text";
const DOCK_MUTED = "bg-rm-danger-tint text-rm-danger-ink";
const DOCK_LIVE = "bg-primary text-primary-foreground [--hover-o:0.12]";
const DOCK_LEAVE = "bg-rm-danger text-rm-on-danger [--hover-o:0.12]";

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
  activeActivity?: ActivityType | null;
  leaveActivity?: () => void;
  isFullscreen: boolean;
  toggleFs: () => void;
  showMembers: boolean;
  setShowMembers: (val: boolean) => void;
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
  const handleCameraModalClose = useCallback(() => {
    setIsCameraModalOpen(false);
  }, []);
  const handleStickerClose = useCallback(() => {
    setIsStickerOpen(false);
  }, []);
  const handleStickerSelect = useCallback(async () => {
    // no-op: voice mode handles send
  }, []);
  const gifPickerVoiceMode = useMemo(() => (sfu ? { sfu } : undefined), [sfu]);

  const isMicMuted = !isMicOn || !hasMicrophone;

  return (
    <>
      <div
        className={cn(
          "flex items-center overflow-x-auto scrollbar-none gap-2",
          variant === "default"
            ? "h-[72px] justify-between px-2 md:px-6 bg-rm-bg-elevated/40"
            : "h-auto py-2 justify-between bg-transparent",
        )}
      >
        <div
          className={cn(
            "hidden md:flex flex-1 items-center gap-2",
            hideExtraControls && "invisible",
          )}
        >
          {isCall && !isFullscreen && (
            <div className={DOCK_GROUP}>
              <button
                type="button"
                onClick={toggleChatHidden}
                aria-pressed={!isChatHidden}
                className={cn(DOCK_BTN, DOCK_REST)}
                title={isChatHidden ? "Show Chat" : "Hide Chat"}
              >
                <Icon
                  name="chat"
                  state={isChatHidden ? "idle" : "active"}
                  size="xl"
                />
              </button>
            </div>
          )}
        </div>

        <div
          className={cn("flex items-center gap-2 md:gap-3 shrink-0 mx-auto")}
        >
          <div className={cn(DOCK_GROUP, "shrink-0")}>
            <button
              type="button"
              title={
                !hasMicrophone
                  ? "No microphone detected"
                  : isMicOn
                    ? "Mute"
                    : "Unmute"
              }
              disabled={!hasMicrophone}
              onClick={toggleMic}
              aria-pressed={isMicMuted}
              className={cn(DOCK_BTN, isMicMuted ? DOCK_MUTED : DOCK_REST)}
            >
              <Icon name="mic" state={isMicMuted ? "off" : "idle"} size="xl" />
            </button>

            <button
              type="button"
              title={isDeafened ? "Undeafen" : "Deafen"}
              onClick={toggleDeafen}
              aria-pressed={isDeafened}
              className={cn(DOCK_BTN, isDeafened ? DOCK_MUTED : DOCK_REST)}
            >
              <Icon
                name="deafen"
                state={isDeafened ? "off" : "idle"}
                size="xl"
              />
            </button>

            <button
              type="button"
              title={
                !hasCamera
                  ? "No camera detected"
                  : isCameraOn
                    ? "Stop Camera"
                    : "Start Camera"
              }
              disabled={!hasCamera}
              onClick={() => {
                void handleVoiceCameraToggle({
                  hasCamera,
                  isCameraActive: isCameraOn,
                  alwaysPreviewVideo: settings?.alwaysPreviewVideo,
                  onToggleCamera: toggleCamera,
                  onOpenPreviewModal: () => setIsCameraModalOpen(true),
                });
              }}
              aria-pressed={isCameraOn}
              className={cn(DOCK_BTN, isCameraOn ? DOCK_LIVE : DOCK_REST)}
            >
              {isCameraOn ? (
                <Icon name="camera" state="active" size="xl" />
              ) : (
                <Icon name="cameraOff" size="xl" />
              )}
            </button>

            <div aria-hidden className={DOCK_DIVIDER} />

            <button
              type="button"
              title={isScreenSharing ? "Stop Stream" : "Share Screen"}
              onClick={() => {
                if (isScreenSharing) toggleScreenShare();
                else setIsScreenModalOpen(true);
              }}
              aria-pressed={isScreenSharing}
              className={cn(DOCK_BTN, isScreenSharing ? DOCK_LIVE : DOCK_REST)}
            >
              <Icon
                name="screenShare"
                state={isScreenSharing ? "active" : "idle"}
                size="xl"
              />
            </button>
            <div aria-hidden className={cn(DOCK_DIVIDER, "hidden md:block")} />
            <button
              type="button"
              title="Activities"
              onClick={onOpenActivities}
              className={cn(DOCK_BTN, DOCK_REST)}
            >
              <Icon name="activities" size="xl" />
            </button>

            {/* GIF/Sticker Reactions — only visible when SFU is connected */}
            {sfu && (
              <div className="relative">
                <button
                  type="button"
                  ref={stickerBtnRef}
                  title="GIF & Sticker Reactions"
                  onClick={() => setIsStickerOpen((v) => !v)}
                  aria-pressed={isStickerOpen}
                  className={cn(
                    DOCK_BTN,
                    isStickerOpen ? DOCK_OPEN : DOCK_REST,
                  )}
                >
                  <Icon
                    name="sticker"
                    state={isStickerOpen ? "active" : "idle"}
                    size="xl"
                  />
                </button>
              </div>
            )}

            <div aria-hidden className={DOCK_DIVIDER} />

            <button
              type="button"
              title={
                activeActivity
                  ? "Leave Activity"
                  : focusedItem?.isStreaming
                    ? "Stop Watching"
                    : "Disconnect"
              }
              onClick={
                activeActivity
                  ? leaveActivity
                  : focusedItem?.isStreaming
                    ? () => setFocusedId(null)
                    : handleLeave
              }
              className={cn(DOCK_BTN, DOCK_LEAVE)}
            >
              <div className="relative size-6 flex items-center justify-center">
                <div
                  className={cn(
                    "absolute inset-0 transition-[opacity,transform] duration-200 ease-out flex items-center justify-center",
                    focusedItem?.isStreaming
                      ? "opacity-100 scale-100 rotate-0"
                      : "opacity-0 scale-75 rotate-45",
                  )}
                >
                  <Icon name="streamOff" size="xl" />
                </div>
                <div
                  className={cn(
                    "absolute inset-0 transition-[opacity,transform] duration-200 ease-out flex items-center justify-center",
                    activeActivity
                      ? "opacity-100 scale-100 rotate-0"
                      : "opacity-0 scale-75 rotate-45",
                  )}
                >
                  <Icon name="close" size="xl" />
                </div>
                <div
                  className={cn(
                    "absolute inset-0 transition-[opacity,transform] duration-200 ease-out flex items-center justify-center",
                    !focusedItem?.isStreaming && !activeActivity
                      ? "opacity-100 scale-100 rotate-0"
                      : "opacity-0 scale-75 -rotate-45",
                  )}
                >
                  <Icon name="disconnect" size="xl" />
                </div>
              </div>
            </button>
          </div>
        </div>
        <div
          className={cn(
            "flex-1 flex items-center justify-end gap-1 md:gap-3 shrink-0",
            hideExtraControls && "invisible",
          )}
        >
          <div className={DOCK_GROUP}>
            <button
              type="button"
              onClick={toggleFs}
              className={cn(DOCK_BTN, DOCK_REST)}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Icon name="minimize" size="xl" />
              ) : (
                <Icon name="maximize" size="xl" />
              )}
            </button>
            {!isCall && (
              <button
                type="button"
                onClick={() => setShowMembers(!showMembers)}
                aria-pressed={showMembers}
                className={cn(DOCK_BTN, showMembers ? DOCK_OPEN : DOCK_REST)}
                title={showMembers ? "Hide Members" : "Show Members"}
              >
                <Icon
                  name="chevronUp"
                  size="xl"
                  className={cn(
                    "transition-transform",
                    !showMembers && "rotate-180",
                  )}
                />
              </button>
            )}
          </div>
        </div>
      </div>
      <CameraSettingsModal
        isOpen={isCameraModalOpen}
        onClose={handleCameraModalClose}
        isCameraActive={isCameraOn}
        onToggleCamera={toggleCamera}
        settingsUserId={settingsUserId}
      />
      {/* GIF Picker in voice reaction mode */}
      {gifPickerVoiceMode && (
        <Suspense fallback={null}>
          <GifPickerModal
            open={isStickerOpen}
            onClose={handleStickerClose}
            onSelect={handleStickerSelect}
            voiceMode={gifPickerVoiceMode}
          />
        </Suspense>
      )}
    </>
  );
}
