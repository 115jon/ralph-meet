import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getAvatarCollectibles } from "@/lib/avatar-display";
import { findCollectibleItem } from "@/lib/collectibles-catalog";
import { getCachedCollectiblesCatalog, subscribeCollectiblesCatalog } from "@/lib/collectibles-catalog-client";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import type { ScreenShareOptions, ScreenShareSourceState } from "@/lib/screen-share-types";
import type { StreamWatchersByStreamer } from "@/lib/stream-watchers";
import type { SharedSpatialAudioState } from "@/lib/voice/spatial-audio";
import { playCallEnd } from "@/lib/sounds";
import type { User } from "@/lib/types";
import { useDeviceAvailability } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { ChevronDown, Headphones, Mic, MicOff, Settings } from "./Icons";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import { ProfileAssetLayer } from "./ProfileAssetLayer";

const EMPTY_QUALITIES: string[] = [];
const EMPTY_GRID_ITEMS: any[] = [];
const EMPTY_WATCHERS_BY_STREAMER: StreamWatchersByStreamer = {};
const SCREEN_SHARE_QUALITIES = getAvailableStreamQualities();
const VoiceDashboard = lazy(() =>
  import("@/components/chat/VoiceDashboard").then((mod) => ({ default: mod.VoiceDashboard }))
);
const AudioDeviceMenu = lazy(() =>
  import("@/components/chat/AudioDeviceMenu").then((mod) => ({ default: mod.AudioDeviceMenu }))
);
const SettingsModal = lazy(() => import("@/components/chat/SettingsModal"));
const UserAccountPopover = lazy(() => import("@/components/chat/UserAccountPopover"));
const UnifiedScreenShareModal = lazy(() =>
  import("@/components/UnifiedScreenShareModal").then((mod) => ({ default: mod.UnifiedScreenShareModal }))
);

interface Props {
  user: User | null;
  serverId?: string | null;
  serverName: string;
  // Voice dashboard
  voiceConnected?: boolean;
  voiceChannelId?: string | null;
  voiceChannelName?: string;
  onVoiceDisconnect?: () => void;
  onVoiceNavigate?: () => void;
  // Streaming state for local user
  isScreenSharing?: boolean;
  isStreamingAudio?: boolean;
  screenQuality?: string;
  currentScreenSource?: ScreenShareSourceState | null;
  availableQualities?: string[];
  onStopStreaming?: () => void;
  onToggleStreamAudio?: () => void;
  onChangeStreamSource?: () => void;
  onStartScreenShare?: (options: ScreenShareOptions) => void;
  onStreamQualityChange?: (quality: string) => void;
  isCameraActive?: boolean;
  hasCamera?: boolean;
  hasMicrophone?: boolean;
  onToggleCamera?: () => void;
  sfu?: any;
  gridItems?: any[];
  watchersByStreamer?: StreamWatchersByStreamer;
  spatialAudioState?: SharedSpatialAudioState;
  onUpdateSpatialAudioState?: (state: SharedSpatialAudioState) => void;
  voiceSettingsUserId?: string;
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
}

const statusColors: Record<string, string> = {
  online: "bg-primary",
  idle: "bg-warning",
  dnd: "bg-destructive",
  offline: "bg-rm-text-muted/40",
};

const NAMEPLATE_SWATCHES: Record<string, string> = {
  amethyst: "#9251ff",
  arctic: "#cdddf2",
  base: "#f5f5f5",
  blue: "#60a5fa",
  clouds: "#9ec9ff",
  emerald: "#34d399",
  gold: "#facc15",
  green: "#4ade80",
  indigo: "#818cf8",
  orange: "#fb923c",
  pink: "#ec7ed1",
  purple: "#b58cff",
  red: "#ef4444",
  violet: "#8b7dff",
  white: "#ffffff",
  yellow: "#facc15",
};

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = c;
    green = x;
  } else if (hue < 120) {
    red = x;
    green = c;
  } else if (hue < 180) {
    green = c;
    blue = x;
  } else if (hue < 240) {
    green = x;
    blue = c;
  } else if (hue < 300) {
    red = x;
    blue = c;
  } else {
    red = c;
    blue = x;
  }

  const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;
  const value = Number.parseInt(expanded, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(color: { r: number; g: number; b: number }, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function mix(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
  amount: number,
) {
  return {
    r: Math.round(left.r + (right.r - left.r) * amount),
    g: Math.round(left.g + (right.g - left.g) * amount),
    b: Math.round(left.b + (right.b - left.b) * amount),
  };
}

function relativeLuminance(color: { r: number; g: number; b: number }) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function accentFromPalette(palette: string | null | undefined, seed: string) {
  const key = palette?.toLowerCase().trim() ?? "";
  if (key && NAMEPLATE_SWATCHES[key]) {
    return NAMEPLATE_SWATCHES[key];
  }

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return hslToHex(Math.abs(hash) % 360, 72, 62);
}

function buildNameplateTheme(palette: string | null | undefined, seed: string) {
  const accentHex = accentFromPalette(palette, seed);
  const accentRgb = hexToRgb(accentHex);
  const isLightAccent = relativeLuminance(accentRgb) > 0.36;
  const inkRgb = isLightAccent ? { r: 11, g: 16, b: 24 } : { r: 255, g: 255, b: 255 };
  const shadeRgb = isLightAccent ? { r: 9, g: 13, b: 20 } : { r: 8, g: 11, b: 18 };
  const cardRgb = isLightAccent ? mix(accentRgb, { r: 255, g: 255, b: 255 }, 0.78) : mix(accentRgb, shadeRgb, 0.58);

  return {
    accentHex,
    isLightAccent,
    textStrong: isLightAccent ? "#0b1018" : "#ffffff",
    textMuted: isLightAccent ? "rgba(11, 16, 24, 0.76)" : "rgba(255, 255, 255, 0.82)",
    textShadow: isLightAccent ? "0 1px 1px rgba(255,255,255,0.4)" : "0 1px 2px rgba(0,0,0,0.88)",
    rowBorder: rgba(accentRgb, isLightAccent ? 0.18 : 0.34),
    rowGlow: rgba(accentRgb, isLightAccent ? 0.16 : 0.24),
    softCardBg: rgba(cardRgb, isLightAccent ? 0.72 : 0.4),
    softCardBorder: rgba(inkRgb, isLightAccent ? 0.12 : 0.16),
    buttonBg: "transparent",
    buttonHoverBg: "transparent",
    buttonActiveBg: "transparent",
    buttonText: "rgba(255, 255, 255, 0.96)",
    buttonMuted: "rgba(255, 255, 255, 0.8)",
    buttonFilter: "drop-shadow(0 1px 1px rgba(0,0,0,0.92)) drop-shadow(0 2px 6px rgba(0,0,0,0.55))",
    statusBack: isLightAccent ? "rgba(255,255,255,0.82)" : "rgba(6,10,16,0.68)",
    statusGlyph: isLightAccent ? "#0b1018" : "#060a10",
  };
}

function CallDashboardSection({
  serverId,
  onOpenActivities,
  onOpenSoundboard,
}: {
  serverId?: string | null;
  onOpenActivities?: () => void;
  onOpenSoundboard?: () => void;
}) {
  const callStatus = useCallStore((s) => s.status);
  const callChannelId = useCallStore((s) => s.channelId);
  const remoteUser = useCallStore((s) => s.remoteUser);

  const activeRemoteUser = useUserResolution(remoteUser?.id, remoteUser);

  // SFU state from the call voice store
  const sfu = useCallVoiceStore((s) => s.sfu);
  const isScreenSharing = useCallVoiceStore((s) => s.isScreenSharing);
  const isStreamingAudio = useCallVoiceStore((s) => s.isStreamingAudio);
  const screenQuality = useCallVoiceStore((s) => s.screenQuality);
  const currentScreenSource = useCallVoiceStore((s) => s.currentScreenSource);
  const isCameraActive = useCallVoiceStore((s) => s.isCameraActive);
  const hasCamera = useCallVoiceStore((s) => s.hasCamera);
  const hasMicrophone = useCallVoiceStore((s) => s.hasMicrophone);
  const toggleCamera = useCallVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useCallVoiceStore((s) => s.toggleScreenShare);
  const onToggleStreamAudio = useCallVoiceStore((s) => s.onToggleStreamAudio);
  const gridItems = useCallVoiceStore((s) => s.gridItems);
  const watchersByStreamer = useCallVoiceStore((s) => s.watchersByStreamer);
  const spatialAudioState = useCallVoiceStore((s) => s.spatialAudioState);
  const updateSharedSpatialAudioState = useCallVoiceStore((s) => s.updateSharedSpatialAudioState);

  const handleCallLeave = useCallVoiceStore((s) => s.handleLeave);
  const defaultParticipantCapabilities = useMemo(
    () => Object.fromEntries(gridItems.map((item) => [item.userId, { enabled: true, highFidelity: true }])),
    [gridItems],
  );

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);

  if (callStatus !== "active") return null;

  return (
    <>
      <VoiceDashboard
        serverName={activeRemoteUser.displayName || activeRemoteUser.username || "Call"}
        onVoiceDisconnect={() => {
          playCallEnd();
          handleCallLeave?.();
          // Fully reset the call store so dashboard, button, and context menu
          // all return to idle. The voice channel continues to exist for others.
          useCallStore.getState().endCall("left");
        }}
        isScreenSharing={isScreenSharing}
        isStreamingAudio={isStreamingAudio}
        screenQuality={screenQuality}
        currentScreenSource={currentScreenSource}
        availableQualities={getAvailableStreamQualities()}
        onStopStreaming={() => toggleScreenShare?.()}
        onToggleStreamAudio={() => onToggleStreamAudio?.()}
        onShareScreen={() => setIsScreenModalOpen(true)}
        onChangeStreamSource={() => setIsScreenModalOpen(true)}
        onStreamQualityChange={(q) => toggleScreenShare?.({ quality: q })}
        isCameraActive={isCameraActive}
        hasCamera={hasCamera}
        hasMicrophone={hasMicrophone}
        onToggleCamera={() => toggleCamera?.()}
        sfu={sfu}
        voiceChannelId={callChannelId}
        gridItems={gridItems}
        watchersByStreamer={watchersByStreamer}
        spatialAudioState={spatialAudioState ?? undefined}
        onUpdateSpatialAudioState={(state) => updateSharedSpatialAudioState?.(state)}
        participantCapabilities={defaultParticipantCapabilities}
        localUserId={useChatStore.getState().user?.id}
        voiceSettingsUserId={useChatStore.getState().user?.id}
        serverId={serverId}
        onOpenActivities={onOpenActivities}
        onOpenSoundboard={onOpenSoundboard}
        showNoiseReductionShortcut
      />
      <UnifiedScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
        onStart={(options) => {
          toggleScreenShare?.({
            ...options,
            changeSource: isScreenSharing,
          });
          setIsScreenModalOpen(false);
        }}
        availableQualities={getAvailableStreamQualities()}
      />
    </>
  );
}

export default function UserPanel({
  user,
  serverId,
  serverName,
  voiceConnected,
  voiceChannelId,
  voiceChannelName,
  onVoiceDisconnect,
  onVoiceNavigate,
  isScreenSharing,
  isStreamingAudio,
  screenQuality,
  currentScreenSource,
  availableQualities = EMPTY_QUALITIES,
  onStopStreaming,
  onToggleStreamAudio,
  onChangeStreamSource,
  onStartScreenShare,
  onStreamQualityChange,
  isCameraActive,
  hasCamera,
  hasMicrophone,
  onToggleCamera,
  sfu,
  gridItems = EMPTY_GRID_ITEMS,
  watchersByStreamer = EMPTY_WATCHERS_BY_STREAMER,
  spatialAudioState,
  onUpdateSpatialAudioState,
  voiceSettingsUserId,
  onOpenActivities,
  onOpenSoundboard,
}: Props) {
  const { updateStatus } = useChatActions();
  const speakingUsers = useChatStore(s => s.speakingUsers);
  const [collectiblesCatalog, setCollectiblesCatalog] = useState(() => getCachedCollectiblesCatalog());
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"account" | "voice" | "shares" | "appearance">("account");
  const [settingsStartInProfileEditor, setSettingsStartInProfileEditor] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [userAvatarEl, setUserAvatarEl] = useState<HTMLButtonElement | null>(null);
  const [activeDeviceMenu, setActiveDeviceMenu] = useState<"input" | "output" | null>(null);
  const [isVcScreenModalOpen, setIsVcScreenModalOpen] = useState(false);
  const micCaretRef = useRef<HTMLButtonElement>(null);
  const headphoneCaretRef = useRef<HTMLButtonElement>(null);

  const shouldRenderMenu = useDelayUnmount(showMenu, 200);
  const shouldRenderSettings = useDelayUnmount(showSettings, 200);

  const settings = useVoiceSettingsStore(useShallow(s => s.getSettings(user?.id)));
  const setIsMuted = useVoiceSettingsStore(s => s.setIsMuted);
  const setIsDeafened = useVoiceSettingsStore(s => s.setIsDeafened);
  const callActive = useCallStore(s => s.status) === "active";
  const participantCapabilities = useMemo(() => {
    const vcMembers = voiceChannelId ? (useChatStore.getState().voiceChannelStates[voiceChannelId] ?? []) : [];
    return Object.fromEntries((gridItems ?? []).map((item: any) => {
      const member = vcMembers.find((m: any) => m.clerk_user_id === item.userId);
      return [item.userId, {
        enabled: member?.spatial_audio_enabled ?? true,
        highFidelity: member?.spatial_audio_high_fidelity ?? true,
      }];
    }));
  }, [gridItems, voiceChannelId]);
  const nameplateSelection = useMemo(
    () => getAvatarCollectibles(user?.avatar_display)?.nameplate,
    [user?.avatar_display],
  );
  const nameplateTheme = useMemo(() => {
    if (!user?.nameplate_url) return null;
    const paletteFromDisplay = nameplateSelection?.palette;
    const paletteFromCatalog = collectiblesCatalog && nameplateSelection?.skuId
      ? findCollectibleItem(collectiblesCatalog, nameplateSelection.skuId)?.palette
      : undefined;
    const seed = nameplateSelection?.skuId ?? user.nameplate_url ?? user.id ?? "nameplate";
    return buildNameplateTheme(paletteFromDisplay ?? paletteFromCatalog, seed);
  }, [collectiblesCatalog, nameplateSelection?.palette, nameplateSelection?.skuId, user?.id, user?.nameplate_url]);

  const openSettings = useCallback((tab: "account" | "voice" | "shares" | "appearance" = "account") => {
    setSettingsStartInProfileEditor(false);
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  const openProfileEditor = useCallback(() => {
    setSettingsInitialTab("account");
    setSettingsStartInProfileEditor(true);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    const handleOpenShares = () => {
      openSettings("shares");
    };
    window.addEventListener("open-shared-messages-settings", handleOpenShares);
    return () => {
      window.removeEventListener("open-shared-messages-settings", handleOpenShares);
    };
  }, [openSettings]);

  useEffect(() => subscribeCollectiblesCatalog((catalog) => setCollectiblesCatalog(catalog)), []);

  // Global device availability from the shared store — used for the bottom-bar
  // mute button so it stays accurate even when no VC/call is active.
  // When a VC IS active, the prop overrides (it comes from the same store anyway).
  const globalDevices = useDeviceAvailability();
  const effectiveHasMic = hasMicrophone ?? globalDevices.hasMicrophone;

  if (!user) return null;

  const currentStatus = user.status ?? "online";
  const displayName = getDisplayName(user);
  const userHandle = user.username ? `@${user.username}` : displayName;
  const hasNameplate = Boolean(user.nameplate_url);

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="mt-auto flex shrink-0 flex-col relative overflow-hidden bg-rm-bg-elevated border border-white/5 rounded-lg m-2 shadow-lg"
        style={{ marginBottom: 'calc(8px + var(--safe-area-bottom, 0px))' }}
      >
        {/* VOICE CONNECTED dashboard (hidden when active call takes precedence) */}
        {voiceConnected && !callActive && (
          <div className="relative z-10">
            <VoiceDashboard
              serverName={serverName}
              voiceChannelName={voiceChannelName}
              onVoiceDisconnect={onVoiceDisconnect}
              onVoiceNavigate={onVoiceNavigate}
              isScreenSharing={isScreenSharing}
              isStreamingAudio={isStreamingAudio}
              screenQuality={screenQuality}
              currentScreenSource={currentScreenSource}
              availableQualities={availableQualities}
              onShareScreen={() => setIsVcScreenModalOpen(true)}
              onStopStreaming={onStopStreaming}
              onToggleStreamAudio={onToggleStreamAudio}
              onChangeStreamSource={onChangeStreamSource}
              onStreamQualityChange={onStreamQualityChange}
              isCameraActive={isCameraActive}
              hasCamera={hasCamera}
              hasMicrophone={hasMicrophone}
              onToggleCamera={onToggleCamera}
              sfu={sfu}
              voiceChannelId={voiceChannelId}
              gridItems={gridItems}
              watchersByStreamer={watchersByStreamer}
              spatialAudioState={spatialAudioState}
              onUpdateSpatialAudioState={onUpdateSpatialAudioState}
              voiceSettingsUserId={voiceSettingsUserId}
              localUserId={user.id}
              serverId={serverId}
               participantCapabilities={participantCapabilities}
               onOpenVoiceSettings={() => {
                 openSettings("voice");
               }}
               onOpenActivities={onOpenActivities}
               onOpenSoundboard={onOpenSoundboard}
               showNoiseReductionShortcut
              />
            <UnifiedScreenShareModal
              isOpen={isVcScreenModalOpen}
              onClose={() => setIsVcScreenModalOpen(false)}
              onStart={(options) => {
                onStartScreenShare?.({
                  ...options,
                  changeSource: isScreenSharing,
                });
                setIsVcScreenModalOpen(false);
              }}
              availableQualities={availableQualities ?? SCREEN_SHARE_QUALITIES}
            />
          </div>
        )}

        {/* ACTIVE CALL dashboard (reuses VoiceDashboard) */}
        <div className="relative z-10">
          <CallDashboardSection
            serverId={serverId}
            onOpenActivities={onOpenActivities}
            onOpenSoundboard={onOpenSoundboard}
          />
        </div>

        {/* User Info Bar */}
        <div className={cn(
          "flex items-center gap-2 p-1.5 relative z-10 overflow-hidden",
          hasNameplate && "isolate",
          (voiceConnected || callActive) && "border-t border-white/5"
        )}
        style={hasNameplate && nameplateTheme ? {
          boxShadow: `inset 0 1px 0 ${nameplateTheme.rowBorder}, 0 0 0 1px ${nameplateTheme.rowBorder}, 0 14px 28px ${nameplateTheme.rowGlow}`,
        } : undefined}>
          {hasNameplate && (
            <>
              <ProfileAssetLayer
                url={user.nameplate_url}
                contentType={user.nameplate_content_type}
                alt={`${displayName} nameplate`}
                className="pointer-events-none z-0 opacity-[0.94] saturate-[1.14] contrast-[1.08] brightness-[1.03]"
              />
              <div
                className="pointer-events-none absolute inset-0 z-0"
                style={{
                  background: nameplateTheme
                    ? `linear-gradient(90deg, ${nameplateTheme.softCardBg}, transparent 38%, rgba(4,7,11,0.14) 72%, rgba(4,7,11,0.38) 100%)`
                    : "linear-gradient(90deg, rgba(0,0,0,0.62), rgba(0,0,0,0.28) 46%, rgba(0,0,0,0.58))",
                }}
              />
              <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.20),_transparent_42%),linear-gradient(180deg,_rgba(255,255,255,0.05),_transparent_62%)]" />
              <div className="pointer-events-none absolute inset-y-0 right-0 z-0 w-28 bg-linear-to-l from-black/30 to-transparent" />
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                ref={setUserAvatarEl}
                className="group relative z-10 cursor-pointer border-0 bg-transparent p-0 pl-0.5 outline-none"
                onClick={() => setShowMenu((v) => !v)}
                aria-label="View user account"
              >
                <div className={cn(
                  "relative z-10 flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground transition-all opacity-90 group-hover:opacity-100",
                  speakingUsers[user.id] && cn(
                    "ring-[3px] ring-primary shadow-[0_0_20px_var(--rm-glow)] ring-offset-2",
                    hasNameplate ? "ring-offset-black" : "ring-offset-rm-bg-elevated"
                  )
                )}>
                  <div className="absolute inset-0 overflow-visible rounded-full flex items-center justify-center">
                    {user.avatar_url ? (
                      <AvatarImage src={getAuthAssetUrl(user.avatar_url)} alt={displayName} display={user.avatar_display} />
                    ) : (
                      getDisplayInitial(user)
                    )}
                  </div>
                </div>
                <div className={cn(
                  "absolute -bottom-0.5 -right-0.5 z-20 rounded-full p-[2.5px]",
                  !hasNameplate && "bg-rm-bg-elevated"
                )}
                style={hasNameplate && nameplateTheme ? {
                  backgroundColor: nameplateTheme.statusBack,
                  boxShadow: `0 0 0 1px ${nameplateTheme.softCardBorder}`,
                } : undefined}>
                  <div className={cn(
                    "flex h-[11px] w-[11px] items-center justify-center rounded-full",
                    statusColors[currentStatus]
                  )}>
                    {currentStatus === "offline" && (
                      <div
                        className={cn("h-[5px] w-[5px] rounded-full", !hasNameplate && "bg-rm-bg-elevated")}
                        style={hasNameplate && nameplateTheme ? { backgroundColor: nameplateTheme.statusGlyph } : undefined}
                      />
                    )}
                    {currentStatus === "dnd" && (
                      <div
                        className={cn("h-[2px] w-[6px] rounded-sm", !hasNameplate && "bg-rm-bg-elevated")}
                        style={hasNameplate && nameplateTheme ? { backgroundColor: nameplateTheme.statusGlyph } : undefined}
                      />
                    )}
                  </div>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
              <p>View Profile</p>
            </TooltipContent>
          </Tooltip>

          <div className={cn(
            "relative z-10 min-w-0 flex-1 py-1 cursor-pointer group/name rounded-[12px] px-2 -ml-1 transition-colors",
            hasNameplate ? "hover:bg-white/10" : "hover:bg-rm-bg-hover/50"
          )}
          style={hasNameplate && nameplateTheme ? {
            backgroundColor: nameplateTheme.softCardBg,
            border: `1px solid ${nameplateTheme.softCardBorder}`,
            boxShadow: `0 10px 24px ${nameplateTheme.rowGlow}`,
          } : undefined}>
            <p className={cn(
              "truncate text-[13px] font-bold leading-tight",
              hasNameplate
                ? "drop-shadow-none"
                : "text-rm-text-primary"
            )}
            style={hasNameplate && nameplateTheme ? { color: nameplateTheme.textStrong, textShadow: nameplateTheme.textShadow } : undefined}>{displayName}</p>
            <p className={cn(
              "truncate text-[11px] leading-tight",
              hasNameplate
                ? "drop-shadow-none"
                : "text-rm-text-muted"
            )}
            style={hasNameplate && nameplateTheme ? { color: nameplateTheme.textMuted, textShadow: nameplateTheme.textShadow } : undefined}>
              {userHandle}
            </p>
          </div>

          <div className="relative z-10 flex items-center -mr-1">
            {/* Mic Group */}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (effectiveHasMic) {
                        // Route through callVoice.toggleMic when in a call (includes sound effects)
                        const callToggle = useCallVoiceStore.getState().toggleMic;
                        if (callActive && callToggle) {
                          callToggle();
                        } else {
                          setIsMuted(!settings.isMuted);
                        }
                      }
                    }}
                    disabled={!effectiveHasMic}
                    className={cn(
                      "rounded-[10px] p-1.5 transition-all outline-none flex items-center justify-center group",
                      (settings.isMuted || !effectiveHasMic)
                        ? (hasNameplate ? "text-red-300 hover:text-red-200" : "text-destructive hover:bg-rm-bg-hover")
                        : (hasNameplate ? "hover:text-inherit" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary"),
                      !effectiveHasMic && "cursor-not-allowed"
                    )}
                    style={hasNameplate && nameplateTheme ? {
                      backgroundColor: nameplateTheme.buttonBg,
                      color: settings.isMuted || !effectiveHasMic ? undefined : nameplateTheme.buttonText,
                      filter: nameplateTheme.buttonFilter,
                    } : undefined}
                  >
                    {(settings.isMuted || !effectiveHasMic)
                      ? <MicOff size={18} />
                      : <Mic size={18} className="group-hover:animate-wiggle" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>{!effectiveHasMic ? "No microphone detected" : (settings.isMuted ? "Unmute" : "Mute")}</p>
                </TooltipContent>
              </Tooltip>

              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={micCaretRef}
                      onClick={() => setActiveDeviceMenu(activeDeviceMenu === 'input' ? null : 'input')}
                      className={cn(
                        "rounded-[10px] p-0.5 transition-all outline-none mr-0.5 group",
                        activeDeviceMenu === 'input'
                          ? (hasNameplate ? "" : "text-rm-text-muted bg-rm-bg-hover")
                          : (hasNameplate ? "" : "text-rm-text-muted/80 dark:text-rm-text-muted/60 hover:text-rm-text")
                      )}
                      style={hasNameplate && nameplateTheme ? {
                        backgroundColor: activeDeviceMenu === "input" ? nameplateTheme.buttonActiveBg : nameplateTheme.buttonBg,
                        color: activeDeviceMenu === "input" ? nameplateTheme.buttonText : nameplateTheme.buttonMuted,
                        filter: nameplateTheme.buttonFilter,
                      } : undefined}
                    >
                      <ChevronDown size={12} strokeWidth={3} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                    <p>Input Settings</p>
                  </TooltipContent>
                </Tooltip>
                {activeDeviceMenu === 'input' && (
                  <Suspense fallback={null}>
                    <AudioDeviceMenu
                      mode="input"
                      anchorRef={micCaretRef}
                      onClose={() => setActiveDeviceMenu(null)}
                      onOpenVoiceSettings={() => {
                        openSettings("voice");
                      }}
                    />
                  </Suspense>
                )}
              </div>
            </div>

            {/* Headphones Group */}
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      // Route through callVoice.toggleDeafen when in a call (includes sound effects)
                      const callToggle = useCallVoiceStore.getState().toggleDeafen;
                      if (callActive && callToggle) {
                        callToggle();
                      } else {
                        setIsDeafened(!settings.isDeafened);
                      }
                    }}
                    className={cn(
                      "rounded-[10px] p-1.5 transition-all outline-none flex items-center justify-center group",
                      settings.isDeafened
                        ? (hasNameplate ? "text-red-300 hover:text-red-200" : "text-destructive hover:bg-rm-bg-hover")
                        : (hasNameplate ? "hover:text-inherit" : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary")
                    )}
                    style={hasNameplate && nameplateTheme ? {
                      backgroundColor: nameplateTheme.buttonBg,
                      color: settings.isDeafened ? undefined : nameplateTheme.buttonText,
                      filter: nameplateTheme.buttonFilter,
                    } : undefined}
                  >
                    <Headphones size={18} className="group-hover:animate-clack" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                  <p>{settings.isDeafened ? "Undeafen" : "Deafen"}</p>
                </TooltipContent>
              </Tooltip>

              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={headphoneCaretRef}
                      onClick={() => setActiveDeviceMenu(activeDeviceMenu === 'output' ? null : 'output')}
                      className={cn(
                        "rounded-[10px] p-0.5 transition-all outline-none mr-0.5 group",
                        activeDeviceMenu === 'output'
                          ? (hasNameplate ? "" : "text-rm-text-muted bg-rm-bg-hover")
                          : (hasNameplate ? "" : "text-rm-text-muted/80 dark:text-rm-text-muted/60 hover:text-rm-text")
                      )}
                      style={hasNameplate && nameplateTheme ? {
                        backgroundColor: activeDeviceMenu === "output" ? nameplateTheme.buttonActiveBg : nameplateTheme.buttonBg,
                        color: activeDeviceMenu === "output" ? nameplateTheme.buttonText : nameplateTheme.buttonMuted,
                        filter: nameplateTheme.buttonFilter,
                      } : undefined}
                    >
                      <ChevronDown size={12} strokeWidth={3} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                    <p>Output Settings</p>
                  </TooltipContent>
                </Tooltip>
                {activeDeviceMenu === 'output' && (
                  <Suspense fallback={null}>
                    <AudioDeviceMenu
                      mode="output"
                      anchorRef={headphoneCaretRef}
                      onClose={() => setActiveDeviceMenu(null)}
                      onOpenVoiceSettings={() => {
                        openSettings("voice");
                      }}
                    />
                  </Suspense>
                )}
              </div>
            </div>

            {/* Settings */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    openSettings("account");
                  }}
                  className={cn(
                    "rounded-[8px] p-1.5 transition-all outline-none flex items-center justify-center group",
                    hasNameplate
                      ? "hover:brightness-110"
                      : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary"
                  )}
                  style={hasNameplate && nameplateTheme ? {
                    backgroundColor: nameplateTheme.buttonBg,
                    color: nameplateTheme.buttonText,
                    textShadow: nameplateTheme.textShadow,
                    filter: nameplateTheme.buttonFilter,
                  } : undefined}
                >
                  <Settings size={18} className="transition-transform duration-500 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] group-hover:rotate-90" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={12} className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg">
                <p>User Settings</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* User Account Popover */}
        {shouldRenderMenu && userAvatarEl && (
          <Suspense fallback={null}>
            <UserAccountPopover
              user={user}
              onClose={() => setShowMenu(false)}
              updateStatus={updateStatus}
              anchorEl={userAvatarEl}
              onOpenProfileEditor={openProfileEditor}
              isClosing={!showMenu}
            />
          </Suspense>
        )}
        {/* Settings Modal */}
        {shouldRenderSettings && (
          <Suspense fallback={null}>
            <SettingsModal
              initialTab={settingsInitialTab}
              initialProfileEditorOpen={settingsStartInProfileEditor}
              onClose={() => {
                setShowSettings(false);
                setSettingsStartInProfileEditor(false);
                setSettingsInitialTab("account"); // reset for next open
              }}
              isClosing={!showSettings}
            />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  );
}
