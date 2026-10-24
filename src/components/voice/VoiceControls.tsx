import { Menu } from "@base-ui/react/menu";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";

import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import { ActionSheet } from "@/components/ui/action-sheet";
import { DOCK_DESTRUCTIVE, DOCK_LEAVE } from "@/components/ui/dock";
import { DockButton } from "@/components/ui/dock-button";
import { Icon, type IconName, type IconState } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_PANEL,
} from "@/components/ui/menu";
import { useIsMobile } from "@/hooks/useMediaQuery";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import { handleVoiceCameraToggle } from "@/lib/voice/camera-toggle";
import type { ActivityType } from "@/stores/useActivityStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

const GifPickerModal = lazy(() => import("@/components/chat/GifPickerModal"));

/**
 * Container width (px) at which the dock shows every control inline. Below
 * it (phones, and the 456px main column at a 768 viewport) the dock keeps
 * mic, deafen, camera, share and Leave, and folds the rest into More.
 *
 * Full row: 7 x 48 + 6 x 8 gaps + 2 dividers (1 + 8) = 402 in the middle,
 * up to 3 x 48 + 2 x 8 on the right, the call's chat toggle on the left and
 * `px-6`: about 674.
 */
export const DOCK_FULL_MIN_WIDTH = 680;

const DIVIDER = "hidden h-6 w-px shrink-0 bg-rm-border @min-[680px]:block";

export interface DockMoreItem {
  key: string;
  label: string;
  icon: IconName;
  iconState?: IconState;
  onSelect: () => void;
}

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
  /**
   * Whether the fullscreen control can work. The stage defaults to the
   * element Fullscreen API (absent on iOS Safari); the DM call's "expand" is
   * in-app and always available.
   */
  fullscreenSupported?: boolean;
  showMembers: boolean;
  setShowMembers: (val: boolean) => void;
  variant?: "default" | "call";
  /** DM call without video: no chat toggle and no expand. */
  hideExtraControls?: boolean;
  isChatHidden?: boolean;
  toggleChatHidden?: () => void;
  onOpenActivities?: () => void;
  /** Room page: opens the room's audio settings. */
  onOpenSettings?: () => void;
  settingsUserId?: string;
  sfu?: SFUClient | null;
}

function supportsElementFullscreen() {
  return typeof document !== "undefined" && !!document.fullscreenEnabled;
}

/**
 * The voice dock (design-system 12.13): 48px `DockButton`s, `gap-2`, the
 * shared `dockState` recipe, Leave as the only solid fill. It is a container
 * query, so it adapts to the column it sits in rather than the viewport.
 */
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
  fullscreenSupported,
  showMembers,
  setShowMembers,
  variant = "default",
  hideExtraControls = false,
  isChatHidden,
  toggleChatHidden,
  onOpenActivities,
  onOpenSettings,
  settingsUserId,
  sfu = null,
}: VoiceControlsProps) {
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isStickerOpen, setIsStickerOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const isMobile = useIsMobile();

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
  const canFullscreen =
    !hideExtraControls &&
    (fullscreenSupported ?? (isCall || supportsElementFullscreen()));
  const showChatToggle =
    isCall && !hideExtraControls && !isFullscreen && !!toggleChatHidden;
  const showMembersToggle = !isCall && !!focusedItem;

  const leave = activeActivity
    ? {
        label: "Leave activity",
        icon: "close" as const,
        onClick: leaveActivity,
        className: DOCK_DESTRUCTIVE,
      }
    : focusedItem?.isStreaming
      ? {
          label: "Stop watching",
          icon: "streamOff" as const,
          onClick: () => setFocusedId(null),
          className: DOCK_DESTRUCTIVE,
        }
      : {
          label: "Disconnect",
          icon: "disconnect" as const,
          onClick: handleLeave,
          className: DOCK_LEAVE,
        };

  const toggleCameraWithPreview = () => {
    void handleVoiceCameraToggle({
      hasCamera,
      isCameraActive: isCameraOn,
      alwaysPreviewVideo: settings?.alwaysPreviewVideo,
      onToggleCamera: toggleCamera,
      onOpenPreviewModal: () => setIsCameraModalOpen(true),
    });
  };

  const fullscreenLabel = isCall
    ? isFullscreen
      ? "Collapse call"
      : "Expand call"
    : isFullscreen
      ? "Exit fullscreen"
      : "Fullscreen";
  const fullscreenIcon: IconName = isFullscreen ? "minimize" : "maximize";

  /* The controls that fold into More below DOCK_FULL_MIN_WIDTH, in order. */
  const moreItems: DockMoreItem[] = [];
  if (onOpenActivities) {
    moreItems.push({
      key: "activities",
      label: "Activities",
      icon: "activities",
      onSelect: onOpenActivities,
    });
  }
  if (sfu) {
    moreItems.push({
      key: "stickers",
      label: "GIF & sticker reactions",
      icon: "sticker",
      onSelect: () => setIsStickerOpen(true),
    });
  }
  if (showMembersToggle) {
    moreItems.push({
      key: "members",
      label: showMembers ? "Hide members" : "Show members",
      icon: "members",
      iconState: showMembers ? "active" : "idle",
      onSelect: () => setShowMembers(!showMembers),
    });
  }
  if (showChatToggle) {
    moreItems.push({
      key: "chat",
      label: isChatHidden ? "Show chat" : "Hide chat",
      icon: "chat",
      iconState: isChatHidden ? "idle" : "active",
      onSelect: () => toggleChatHidden?.(),
    });
  }
  if (canFullscreen) {
    moreItems.push({
      key: "fullscreen",
      label: fullscreenLabel,
      icon: fullscreenIcon,
      onSelect: toggleFs,
    });
  }
  if (onOpenSettings) {
    moreItems.push({
      key: "settings",
      label: "Audio settings",
      icon: "settings",
      onSelect: onOpenSettings,
    });
  }

  const moreTrigger = (
    <DockButton
      state={isMoreOpen ? "open" : "rest"}
      icon="more"
      aria-label="More controls"
      aria-haspopup="menu"
      aria-expanded={isMoreOpen}
      className="@min-[680px]:hidden"
      onClick={isMobile ? () => setIsMoreOpen(true) : undefined}
    />
  );

  return (
    <>
      <div data-voice-dock className="@container w-full">
        <div className="flex items-center gap-2 px-4 py-3 @min-[680px]:px-6">
          {/* Leading: the call's chat toggle. Only in the full row. */}
          <div className="hidden min-w-0 flex-1 basis-0 items-center gap-2 @min-[680px]:flex">
            {showChatToggle && (
              <DockButton
                state={isChatHidden ? "rest" : "open"}
                icon="chat"
                tooltip={isChatHidden ? "Show chat" : "Hide chat"}
                aria-pressed={!isChatHidden}
                onClick={toggleChatHidden}
              />
            )}
          </div>

          <div className="mx-auto flex shrink-0 items-center gap-2">
            <DockButton
              state={isMicMuted ? "muted" : "rest"}
              icon="mic"
              tooltip={
                !hasMicrophone
                  ? "No microphone detected"
                  : isMicOn
                    ? "Mute"
                    : "Unmute"
              }
              disabled={!hasMicrophone}
              aria-pressed={isMicMuted}
              onClick={toggleMic}
            />
            <DockButton
              state={isDeafened ? "muted" : "rest"}
              icon="deafen"
              tooltip={isDeafened ? "Undeafen" : "Deafen"}
              aria-pressed={isDeafened}
              onClick={toggleDeafen}
            />
            <DockButton
              state={isCameraOn ? "live" : "rest"}
              icon="camera"
              tooltip={
                !hasCamera
                  ? "No camera detected"
                  : isCameraOn
                    ? "Turn off camera"
                    : "Turn on camera"
              }
              disabled={!hasCamera}
              aria-pressed={isCameraOn}
              onClick={toggleCameraWithPreview}
            />
            <DockButton
              state={isScreenSharing ? "live" : "rest"}
              icon="screenShare"
              tooltip={isScreenSharing ? "Stop sharing" : "Share screen"}
              aria-pressed={isScreenSharing}
              onClick={() => {
                if (isScreenSharing) toggleScreenShare();
                else setIsScreenModalOpen(true);
              }}
            />

            {(onOpenActivities || sfu) && (
              <div aria-hidden className={DIVIDER} />
            )}
            {onOpenActivities && (
              <DockButton
                state="rest"
                icon="activities"
                tooltip="Activities"
                className="hidden @min-[680px]:inline-flex"
                onClick={onOpenActivities}
              />
            )}
            {sfu && (
              <DockButton
                state={isStickerOpen ? "open" : "rest"}
                icon="sticker"
                tooltip="GIF & sticker reactions"
                aria-pressed={isStickerOpen}
                className="hidden @min-[680px]:inline-flex"
                onClick={() => setIsStickerOpen((v) => !v)}
              />
            )}

            {moreItems.length > 0 &&
              (isMobile ? (
                moreTrigger
              ) : (
                <Menu.Root open={isMoreOpen} onOpenChange={setIsMoreOpen}>
                  <Menu.Trigger render={moreTrigger} />
                  <Menu.Portal>
                    <Menu.Positioner
                      side="top"
                      align="end"
                      sideOffset={8}
                      collisionPadding={12}
                      className="z-50 outline-none"
                    >
                      <Menu.Popup
                        className={cn(
                          MENU_PANEL,
                          "min-w-[200px] max-w-[280px] origin-(--transform-origin) outline-none transition-[opacity,transform] duration-150 ease-(--rm-ease-out) data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
                        )}
                      >
                        {moreItems.map((item) => (
                          <Menu.Item
                            key={item.key}
                            onClick={item.onSelect}
                            className={cn(
                              MENU_ITEM,
                              MENU_ITEM_DEFAULT,
                              "data-[highlighted]:bg-rm-tint-2",
                            )}
                          >
                            <Icon
                              name={item.icon}
                              state={item.iconState}
                              size="sm"
                              className={MENU_ICON}
                            />
                            {item.label}
                          </Menu.Item>
                        ))}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              ))}

            <div aria-hidden className={DIVIDER} />
            <IconButton
              variant="plain"
              size="lg"
              icon={leave.icon}
              tooltip={leave.label}
              className={leave.className}
              onClick={leave.onClick}
            />
          </div>

          {/* Trailing: fullscreen, settings, members. Only in the full row. */}
          <div className="hidden min-w-0 flex-1 basis-0 items-center justify-end gap-2 @min-[680px]:flex">
            {onOpenSettings && (
              <DockButton
                state="rest"
                icon="settings"
                tooltip="Audio settings"
                onClick={onOpenSettings}
              />
            )}
            {canFullscreen && (
              <DockButton
                state="rest"
                icon={fullscreenIcon}
                tooltip={fullscreenLabel}
                onClick={toggleFs}
              />
            )}
            {showMembersToggle && (
              <DockButton
                state={showMembers ? "open" : "rest"}
                icon="members"
                tooltip={showMembers ? "Hide members" : "Show members"}
                aria-pressed={showMembers}
                onClick={() => setShowMembers(!showMembers)}
              />
            )}
          </div>
        </div>
      </div>

      {isMobile && (
        <ActionSheet
          open={isMoreOpen}
          onOpenChange={setIsMoreOpen}
          title="More controls"
          items={moreItems.map((item) => ({
            key: item.key,
            label: item.label,
            icon: <Icon name={item.icon} state={item.iconState} size="lg" />,
            onClick: item.onSelect,
          }))}
        />
      )}

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
