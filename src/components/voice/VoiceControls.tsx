import { Menu } from "@base-ui/react/menu";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";

import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import { ActionSheet } from "@/components/ui/action-sheet";
import { DOCK_LEAVE } from "@/components/ui/dock";
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
const SoundboardPicker = lazy(
  () => import("@/components/chat/SoundboardPicker"),
);

/*
 * The bar shows every control inline from a 680px container (the
 * `@min-[680px]` classes). Below it (phones, narrow columns) it keeps the
 * call's core controls and Leave, and folds the rest into More.
 */

const DIVIDER = "hidden h-8 w-px shrink-0 bg-line @min-[680px]:block";

/**
 * A phone row can carry seven keys (mic, deafen, camera, share, more, stop
 * watching, Leave). Rather than clip Leave, keys may give up to 44px of width
 * (still a full touch target) before the row would overflow.
 */
const KEY_FIT = "shrink min-w-11";

/**
 * Call keys are 48 square with a 20px glyph (DESIGN.md, call dock; the kit's
 * CallBar). `DockButton` defaults to 40, so every key here passes this. A key
 * that sets its own `className` includes KEY_FIT itself.
 */
const KEY = { size: "lg", iconSize: "lg", className: KEY_FIT } as const;

interface DockMoreItem {
  key: string;
  label: string;
  icon: IconName;
  iconState?: IconState;
  onSelect: () => void;
}

/** What the soundboard picker needs to play into this call. */
interface StageSoundboardContext {
  serverId?: string | null;
  channelId?: string | null;
  roomSlug?: string | null;
  voiceSessionId?: string | null;
  localUserId?: string | null;
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
  /**
   * Mic and deafen live in the account row (talk-tree-spec §3, "controls
   * once per viewport"). The bar adds them only where that row is out of
   * view: fullscreen, phones (sidebar closed) and the public room page, which
   * has no account row. Default: fullscreen or phone.
   */
  showMicDeafen?: boolean;
  /** Adds the soundboard to the bar (the call strip collapses on stage). */
  soundboard?: StageSoundboardContext;
}

function supportsElementFullscreen() {
  return typeof document !== "undefined" && !!document.fullscreenEnabled;
}

/**
 * The stage bar (talk-tree-spec §3 rule 3): it owns the call's actions while
 * the stage is on screen. 48px square keys on the shared `dockState` recipe,
 * Leave as the only solid fill and always the last control, always meaning
 * "leave the call". Stop watching and Leave activity are neutral and sit
 * before the divider. A container query adapts it to its column.
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
  showMicDeafen,
  soundboard,
}: VoiceControlsProps) {
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isStickerOpen, setIsStickerOpen] = useState(false);
  const [isSoundboardOpen, setIsSoundboardOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const soundboardBtnRef = useRef<HTMLButtonElement>(null);
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

  // One source for mute and deafen: the voice settings store, the same one
  // the account row reads, so the two surfaces can never disagree.
  const micOn = settingsUserId ? !settings.isMuted : isMicOn;
  const deafened = settingsUserId ? !!settings.isDeafened : isDeafened;
  const isMicMuted = !micOn || !hasMicrophone;
  const ownsMicDeafen = showMicDeafen ?? (isFullscreen || isMobile);
  const canFullscreen =
    !hideExtraControls &&
    (fullscreenSupported ?? (isCall || supportsElementFullscreen()));
  const showChatToggle =
    isCall && !hideExtraControls && !isFullscreen && !!toggleChatHidden;
  const showMembersToggle = !isCall && !!focusedItem;
  const watchingStream = !!focusedItem?.isStreaming && !focusedItem?.isLocal;

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

  /* The controls that fold into More below 680px, in order. */
  const moreItems: DockMoreItem[] = [];
  if (onOpenActivities) {
    moreItems.push({
      key: "activities",
      label: "Activities",
      icon: "activities",
      onSelect: onOpenActivities,
    });
  }
  if (soundboard) {
    moreItems.push({
      key: "soundboard",
      label: "Soundboard",
      icon: "soundboard",
      onSelect: () => setIsSoundboardOpen(true),
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
      {...KEY}
      state={isMoreOpen ? "open" : "rest"}
      icon="more"
      aria-label="More controls"
      aria-haspopup="menu"
      aria-expanded={isMoreOpen}
      className={cn(KEY_FIT, "@min-[680px]:hidden")}
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
                {...KEY}
                state={isChatHidden ? "rest" : "open"}
                icon="chat"
                tooltip={isChatHidden ? "Show chat" : "Hide chat"}
                aria-pressed={!isChatHidden}
                onClick={toggleChatHidden}
              />
            )}
          </div>

          <div className="mx-auto flex max-w-full min-w-0 shrink items-center gap-2">
            {ownsMicDeafen && (
              <>
                <DockButton
                  {...KEY}
                  state={isMicMuted ? "muted" : "rest"}
                  icon="mic"
                  tooltip={
                    !hasMicrophone
                      ? "No microphone detected"
                      : micOn
                        ? "Mute"
                        : "Unmute"
                  }
                  disabled={!hasMicrophone}
                  aria-pressed={isMicMuted}
                  onClick={toggleMic}
                />
                <DockButton
                  {...KEY}
                  state={deafened ? "muted" : "rest"}
                  icon="deafen"
                  tooltip={deafened ? "Undeafen" : "Deafen"}
                  aria-pressed={deafened}
                  onClick={toggleDeafen}
                />
              </>
            )}
            <DockButton
              {...KEY}
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
              {...KEY}
              state={isScreenSharing ? "live" : "rest"}
              icon="screenShare"
              tooltip={isScreenSharing ? "Stop sharing" : "Share screen"}
              aria-pressed={isScreenSharing}
              onClick={() => {
                if (isScreenSharing) toggleScreenShare();
                else setIsScreenModalOpen(true);
              }}
            />

            {(onOpenActivities || soundboard || sfu) && (
              <div aria-hidden className={DIVIDER} />
            )}
            {onOpenActivities && (
              <DockButton
                {...KEY}
                state="rest"
                icon="activities"
                tooltip="Activities"
                className={cn(KEY_FIT, "hidden @min-[680px]:inline-flex")}
                onClick={onOpenActivities}
              />
            )}
            {soundboard && (
              <DockButton
                {...KEY}
                ref={soundboardBtnRef}
                state={isSoundboardOpen ? "open" : "rest"}
                icon="soundboard"
                tooltip="Soundboard"
                aria-expanded={isSoundboardOpen}
                className={cn(KEY_FIT, "hidden @min-[680px]:inline-flex")}
                onClick={() => setIsSoundboardOpen((v) => !v)}
              />
            )}
            {sfu && (
              <DockButton
                {...KEY}
                state={isStickerOpen ? "open" : "rest"}
                icon="sticker"
                tooltip="GIF & sticker reactions"
                aria-pressed={isStickerOpen}
                className={cn(KEY_FIT, "hidden @min-[680px]:inline-flex")}
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
                          "rm-presence min-w-[200px] max-w-[280px] outline-none",
                        )}
                      >
                        {moreItems.map((item) => (
                          <Menu.Item
                            key={item.key}
                            onClick={item.onSelect}
                            className={cn(
                              MENU_ITEM,
                              MENU_ITEM_DEFAULT,
                              "data-[highlighted]:bg-tint-2",
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

            {/* Neutral exits that are NOT leaving the call sit before the
                divider, so the red slot only ever means one thing. */}
            {activeActivity && leaveActivity && (
              <DockButton
                {...KEY}
                state="rest"
                icon="close"
                tooltip="Leave activity"
                onClick={leaveActivity}
              />
            )}
            {!activeActivity && watchingStream && (
              <DockButton
                {...KEY}
                state="rest"
                icon="streamOff"
                tooltip="Stop watching"
                onClick={() => setFocusedId(null)}
              />
            )}

            <div aria-hidden className={DIVIDER} />
            <IconButton
              variant="plain"
              {...KEY}
              icon="disconnect"
              tooltip="Leave call"
              className={cn(KEY_FIT, DOCK_LEAVE)}
              onClick={handleLeave}
            />
          </div>

          {/* Trailing: settings, fullscreen, members. Only in the full row. */}
          <div className="hidden min-w-0 flex-1 basis-0 items-center justify-end gap-2 @min-[680px]:flex">
            {onOpenSettings && (
              <DockButton
                {...KEY}
                state="rest"
                icon="settings"
                tooltip="Audio settings"
                onClick={onOpenSettings}
              />
            )}
            {canFullscreen && (
              <DockButton
                {...KEY}
                state="rest"
                icon={fullscreenIcon}
                tooltip={fullscreenLabel}
                onClick={toggleFs}
              />
            )}
            {showMembersToggle && (
              <DockButton
                {...KEY}
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
      {soundboard && isSoundboardOpen && (
        <Suspense fallback={null}>
          <SoundboardPicker
            open={isSoundboardOpen}
            onClose={() => setIsSoundboardOpen(false)}
            placement="top-start"
            markerRef={soundboardBtnRef}
            initialView="soundboard"
            sfu={sfu}
            serverId={soundboard.serverId}
            channelId={soundboard.channelId}
            roomSlug={soundboard.roomSlug}
            voiceSessionId={soundboard.voiceSessionId}
            isClosing={!isSoundboardOpen}
            localUserId={soundboard.localUserId}
          />
        </Suspense>
      )}
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
