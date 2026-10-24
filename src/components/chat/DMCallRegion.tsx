"use client";

import { getDisplayName } from "@/lib/display-name";
import {
  CALL_ACCEPT,
  DOCK_DESTRUCTIVE,
  DOCK_LEAVE,
} from "@/components/ui/dock";
import { DockButton } from "@/components/ui/dock-button";
import { IconButton } from "@/components/ui/IconButton";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { playCallEnd, playRingStop, resumeSoundContext } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { isVoiceMemberReconnecting } from "@/lib/voice-presence";
import {
  disposePrewarmedAudioContext,
  prewarmAudioContext,
} from "@/lib/voice/audio-pipeline";
import { getAvailableStreamQualities } from "@/lib/voice/utils";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Icon } from "@/components/ui/icon";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { AvatarImage } from "./AvatarImage";
import InlineEmojiText from "./InlineEmojiText";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { VoiceGrid } from "@/components/voice/VoiceGrid";

const UnifiedScreenShareModal = lazy(() =>
  import("@/components/UnifiedScreenShareModal").then((mod) => ({
    default: mod.UnifiedScreenShareModal,
  })),
);

/* Lobby / ringing actions use the dock geometry (48px IconButton). Join
 * voice is the conventional green on the shared success token (one solid),
 * Join with video is a resting tint, Decline / Cancel the solid danger. */

function getEventEpochMs(event: MouseEvent<HTMLElement>) {
  return Math.round(performance.timeOrigin + event.timeStamp);
}

/** Stable empty array for Zustand selector fallback (avoids infinite re-renders) */
const EMPTY_MEMBERS: any[] = [];

/**
 * In-DM call region rendered inside ChatArea when a call is active/ringing
 * for the current DM channel. Takes up space in the chat column (not overlay).
 * Shows participant avatars with mute/deafen badges, media tiles for
 * camera/screen streams, controls, and join buttons.
 */
export function DMCallRegion({ channelId }: { channelId: string }) {
  const {
    status,
    callId,
    remoteUser,
    channelId: callChannelId,
    startedAt: _startedAt,
    hasConnected,
    hasJoinedSFU,
    voiceRoomId,
  } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);
  const currentUser = useChatStore((s) => s.user);

  const activeRemoteUser = useUserResolution(remoteUser?.id, remoteUser);
  const activeCurrentUser = useUserResolution(currentUser?.id, currentUser);

  // Voice channel members for this DM channel (unified voice state).
  // IMPORTANT: fallback must be a stable reference — creating `[]` inside a
  // Zustand selector causes Object.is to fail every render → infinite loop.
  const voiceMembers =
    useChatStore((s) => s.voiceChannelStates[channelId]) ?? EMPTY_MEMBERS;

  // Call voice state from the SFU
  const callVoice = useCallVoiceStore();

  // Mute/deafen from voice settings (works globally)
  const isMuted = useVoiceSettingsStore((s) => s.getSettings().isMuted);
  const isDeafened = useVoiceSettingsStore((s) => s.getSettings().isDeafened);

  const dmChannel = useChatStore((s) =>
    s.dmChannels.find((c) => c.id === channelId),
  ) as any;
  const remoteMember = voiceMembers.find(
    (m: any) => m.clerk_user_id !== currentUser?.id,
  );
  const otherUserId = dmChannel?.recipient?.id || remoteMember?.clerk_user_id;

  const isActive = voiceMembers.length > 0;
  const isRingingOutgoing =
    status === "ringing_outgoing" && callChannelId === channelId;
  const isRingingIncoming =
    status === "ringing_incoming" && callChannelId === channelId;

  const [isExpanded, setIsExpanded] = useState(false);
  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [isChatHidden, setIsChatHidden] = useState(false);

  const focusedId = callVoice.focusedId;
  const setFocusedId = useMemo(
    () => callVoice.setFocusedId ?? (() => {}),
    [callVoice.setFocusedId],
  );
  const watchersByStreamer = callVoice.watchersByStreamer;

  const _prevVideoCount = useRef<number>(0);
  const prevFirstScreenId = useRef<string | null>(null);

  // Auto-reset UI and auto-focus streams
  useEffect(() => {
    if (!isActive || !hasJoinedSFU) return;
    let cancelled = false;

    // 1. Check video presence for UI reset. ONLY when there is video can the UI be expanded.
    // So if no video exists, aggressively force the UI back to standard layout.
    const hasVideoNow = callVoice.gridItems.some(
      (i: any) =>
        (i.type === "camera" &&
          i.stream &&
          i.stream.getVideoTracks().length > 0) ||
        i.type === "screen",
    );

    if (!hasVideoNow) {
      queueMicrotask(() => {
        if (cancelled) return;
        setIsExpanded(false);
        setIsChatHidden(false);
      });
    }

    // 2. Auto-focus new screen shares
    const firstScreenId =
      callVoice.gridItems.find((i: any) => i.type === "screen")?.id || null;

    if (firstScreenId && firstScreenId !== prevFirstScreenId.current) {
      setFocusedId(firstScreenId);
    } else if (!firstScreenId && prevFirstScreenId.current) {
      if (focusedId === prevFirstScreenId.current) setFocusedId(null);
    }
    prevFirstScreenId.current = firstScreenId;

    return () => {
      cancelled = true;
    };
  }, [callVoice.gridItems, isActive, hasJoinedSFU, focusedId, setFocusedId]);

  // Only show if there's someone in the voice channel OR if it's currently ringing
  if (!isActive && !isRingingOutgoing && !isRingingIncoming) return null;

  // Deterministically compute voiceRoomId if active
  const sortedIds = [currentUser?.id || "", otherUserId || ""].sort();
  const computedVoiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;
  const actualVoiceRoomId = voiceRoomId || computedVoiceRoomId;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAccept = (joinedAt: number) => {
    prewarmAudioContext();
    resumeSoundContext();
    window.dispatchEvent(new CustomEvent("force-voice-disconnect"));

    if (isRingingIncoming && callId) {
      // Answering a ringing call — MUST send accept to the server so it
      // clears the pending ring and transitions both parties to active.
      // Note: isActive may already be true here because the caller is already
      // in the voice channel, but we still need the server handshake.
      gateway?.sendCallAccept(callId);
    } else if (isActive) {
      // Rejoining an existing call (lobby → SFU).
      // After a page reload the call store is empty (idle), so we need to
      // bootstrap the full call metadata before CallVoiceManager can render.
      const store = useCallStore.getState();
      if (store.status === "idle") {
        // Reconstruct remote user from the voice channel member list
        const remoteMember = voiceMembers.find(
          (m: any) => m.clerk_user_id !== currentUser?.id,
        );
        const remoteInfo = remoteMember
          ? {
              id: remoteMember.clerk_user_id,
              username: remoteMember.username ?? remoteMember.name ?? "User",
              display_name:
                remoteMember.display_name ??
                remoteMember.name ??
                remoteMember.username ??
                "User",
              avatar_url: remoteMember.avatar_url ?? undefined,
              avatar_display: remoteMember.avatar_display ?? null,
            }
          : otherUserId
            ? {
                id: otherUserId,
                username: activeRemoteUser.username,
                display_name: activeRemoteUser.displayName,
                avatar_url: activeRemoteUser.avatarUrl || undefined,
                avatar_display: activeRemoteUser.avatarDisplay,
              }
            : null;

        // Set the store to active with all required metadata so CallVoiceManager renders
        useCallStore.setState({
          status: "active",
          callId: null, // no call_id — this is a cold rejoin
          remoteUser: remoteInfo,
          channelId,
          voiceRoomId: actualVoiceRoomId,
          startedAt: joinedAt,
          endReason: null,
          hasConnected: true,
          hasJoinedSFU: true,
        });
      } else {
        // Already have call metadata, just flip SFU on
        store.joinSFU();
      }
    }
  };

  const handleAcceptWithVideo = (event: MouseEvent<HTMLButtonElement>) => {
    handleAccept(getEventEpochMs(event));
    const unsub = useCallVoiceStore.subscribe((state) => {
      if (state.toggleCamera) {
        state.toggleCamera();
        unsub();
      }
    });
  };

  const handleDecline = () => {
    disposePrewarmedAudioContext();
    playRingStop();
    if (callId) gateway?.sendCallDecline(callId);
    useCallStore.getState().endCall("declined");
  };

  const handleLeave = async () => {
    // Leave the SFU and fully reset the call store.
    // The SFU disconnect (via callVoice.handleLeave) sends sendVoiceChannelLeave
    // which removes from voiceChannelMembers → broadcasts VOICE_CHANNEL_STATE_UPDATE.
    playCallEnd();
    await callVoice.handleLeave?.();
    useCallStore.getState().endCall("left");
  };

  const handleCancelCall = () => {
    disposePrewarmedAudioContext();
    playRingStop();
    if (callId) gateway?.sendCallEnd(callId);
    // Let the server's CALL_CANCELLED callback handle state updates for the caller
  };

  // ── Display items ─────────────────────────────────────────────────────────

  const displayItems = [...callVoice.gridItems];

  // Resolve who the other person is for the UI overlay
  let computedRemoteUser = remoteUser;
  if (!computedRemoteUser && activeRemoteUser && otherUserId) {
    computedRemoteUser = {
      id: otherUserId,
      username: activeRemoteUser.username,
      display_name: activeRemoteUser.displayName,
      avatar_url: activeRemoteUser.avatarUrl || undefined,
      avatar_display: activeRemoteUser.avatarDisplay,
    };
  } else if (!computedRemoteUser && otherUserId) {
    // Try to guess from voice members if remoteUser isn't in useCallStore anymore
    const member = voiceMembers.find((m) => m.clerk_user_id === otherUserId);
    computedRemoteUser = {
      id: otherUserId,
      username: member?.username || member?.name || "User",
      display_name:
        member?.display_name || member?.name || member?.username || "User",
      avatar_url: member?.avatar_url ?? undefined,
      avatar_display: member?.avatar_display ?? null,
    };
  }

  const remoteDisplayName = getDisplayName(computedRemoteUser, "User");

  // Find if remote user is actually sitting in the voice channel natively right now
  const isRemoteUserInLobby = voiceMembers.some(
    (m) => m.clerk_user_id === computedRemoteUser?.id,
  );
  const fakeHasConnected = hasConnected || isRemoteUserInLobby;

  if (
    isActive &&
    computedRemoteUser &&
    !fakeHasConnected &&
    !displayItems.some((i) => i.userId === computedRemoteUser?.id)
  ) {
    // Remote user hasn't connected yet (ringing) — show their avatar with pulse
    displayItems.push({
      id: `ringing-${computedRemoteUser.id}`,
      userId: computedRemoteUser.id,
      name: remoteDisplayName,
      avatar: computedRemoteUser.avatar_url,
      avatarDisplay: computedRemoteUser.avatar_display,
      type: "camera",
      isLocal: false,
      isSpeaking: false,
      isMuted: true,
      isDeafened: false,
      serverMute: false,
      volume: 1,
      stream: null,
      isStreaming: false,
      isRinging: true,
    } as any);
  }
  displayItems.sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));

  // When NOT in the SFU, build a participant display list.
  // Priority: call store metadata (for ringing), then voice channel members (for active/reload).
  const lobbyParticipants: {
    id: string;
    name: string;
    avatarUrl?: string;
    avatarDisplay?: AvatarDisplay | string | null;
    isLocal: boolean;
    isMuted: boolean;
    isDeafened: boolean;
    isInVoice: boolean;
    isReconnecting?: boolean;
  }[] = [];

  if (!hasJoinedSFU && (isActive || isRingingOutgoing || isRingingIncoming)) {
    if (isRingingOutgoing || isRingingIncoming) {
      // ── Ringing state: use call store metadata ──────────────────────────
      // Show ourselves (caller always, callee with pulse)
      if (currentUser) {
        const meMember = voiceMembers.find(
          (m: any) => m.clerk_user_id === currentUser.id,
        );
        const meInVoice = !!meMember;
        const shouldShowMe = isRingingOutgoing ? true : meInVoice;
        if (shouldShowMe) {
          lobbyParticipants.push({
            id: currentUser.id,
            name: activeCurrentUser.displayName,
            avatarUrl: activeCurrentUser.avatarUrl || undefined,
            avatarDisplay: activeCurrentUser.avatarDisplay,
            isLocal: true,
            isMuted,
            isDeafened,
            isInVoice: meInVoice,
            isReconnecting: meMember
              ? isVoiceMemberReconnecting(meMember)
              : false,
          });
        }
      }
      if (remoteUser) {
        const remoteMember = voiceMembers.find(
          (m: any) => m.clerk_user_id === remoteUser.id,
        );
        lobbyParticipants.push({
          id: remoteUser.id,
          name: activeRemoteUser.displayName,
          avatarUrl: activeRemoteUser.avatarUrl || undefined,
          avatarDisplay: activeRemoteUser.avatarDisplay,
          isLocal: false,
          isMuted: remoteMember?.self_mute ?? false,
          isDeafened: remoteMember?.self_deaf ?? false,
          isInVoice: !!remoteMember,
          isReconnecting: remoteMember
            ? isVoiceMemberReconnecting(remoteMember)
            : false,
        });
      }
    } else {
      // ── Active lobby (not ringing): show voice channel members ──────────
      // This handles page reload, re-joining, or viewing an ongoing call.
      // We show everyone currently in the voice channel EXCEPT ourselves.
      for (const m of voiceMembers) {
        if (m.clerk_user_id === currentUser?.id) continue; // don't show ourselves in lobby
        lobbyParticipants.push({
          id: m.clerk_user_id,
          name: getDisplayName(
            {
              display_name: m.display_name,
              username: m.username,
              name: m.name,
            },
            "User",
          ),
          avatarUrl: m.avatar_url ?? undefined,
          avatarDisplay: m.avatar_display ?? null,
          isLocal: false,
          isMuted: m.self_mute ?? false,
          isDeafened: m.self_deaf ?? false,
          isInVoice: true,
          isReconnecting: isVoiceMemberReconnecting(m),
        });
      }
    }
  }

  const hasVideoFeed =
    isActive &&
    hasJoinedSFU &&
    displayItems.some(
      (i) =>
        (i.type === "camera" &&
          i.stream &&
          i.stream.getVideoTracks().length > 0) ||
        i.type === "screen",
    );
  const isFullscreenView = hasVideoFeed || isExpanded || isChatHidden;
  const showVideoStage = isFullscreenView && hasJoinedSFU;
  const isLobby = !hasJoinedSFU || !isActive;
  const lobbyItems =
    isActive && hasJoinedSFU ? displayItems : lobbyParticipants;

  return (
    <section
      aria-label={`Call with ${remoteDisplayName}`}
      data-call-region={
        isExpanded ? "expanded" : isChatHidden ? "chat-hidden" : "inline"
      }
      className={cn(
        "flex w-full shrink-0 flex-col overflow-hidden bg-rm-bg-primary",
        isExpanded
          ? // Expanded call: a full-screen surface, padded for the notch and
            // the home indicator (3.6). The dock panel pads the bottom.
            "fixed inset-0 z-50 pt-[var(--safe-area-top,0px)] pr-[var(--safe-area-right,0px)] pl-[var(--safe-area-left,0px)]"
          : isChatHidden
            ? "absolute inset-0 z-30"
            : "relative min-h-72 border-b border-rm-border",
      )}
    >
      {showVideoStage ? (
        /* Black only behind video. `transform-gpu` keeps Chromium from
         * tearing the video layer diagonally while the region resizes. */
        <div
          className={cn(
            "relative min-h-0 transform-gpu bg-black",
            isExpanded || isChatHidden ? "flex-1" : "h-64 md:h-80",
          )}
        >
          <VoiceGrid
            layoutMode={isExpanded || isChatHidden ? "grid" : "row"}
            items={displayItems}
            focusedId={focusedId}
            onFocus={setFocusedId}
            globalDeafened={isDeafened}
            currentSettings={{ peerSettings: {} }}
            watchedStreams={callVoice.watchedStreams}
            streamThumbnails={callVoice.streamThumbnails}
            voiceActions={{
              onToggleScreenShare: callVoice.toggleScreenShare || (() => {}),
              isCurrentUserStreaming: callVoice.isScreenSharing,
              currentScreenQuality: callVoice.screenQuality,
              isStreamingAudio: callVoice.isStreamingAudio,
              onToggleStreamAudio: callVoice.onToggleStreamAudio || (() => {}),
              onToggleWatch: callVoice.onToggleWatch || (() => {}),
              watchedStreams: callVoice.watchedStreams,
              watchersByStreamer,
              availableQualities: getAvailableStreamQualities(),
              onLeave: handleLeave,
              isMuted: !callVoice.isMicOn,
              onToggleMute: callVoice.toggleMic || (() => {}),
              isDeafened: isDeafened,
              onToggleDeafen: callVoice.toggleDeafen || (() => {}),
              onChangeSource: () => setIsScreenModalOpen(true),
              togglePreviewHidden: callVoice.togglePreviewHidden || undefined,
              isPreviewHidden: callVoice.isPreviewHidden,
              sfu: null,
            }}
          />
        </div>
      ) : (
        /* Lobby / ringing / audio-only: people as avatars on the page colour. */
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-6">
          <ul className="flex flex-wrap items-start justify-center gap-8 md:gap-16">
            {lobbyItems.map((p: any) => {
              const item = isLobby
                ? {
                    id: p.id,
                    userId: p.id,
                    name: p.name || p.username,
                    avatar: p.avatarUrl || p.avatar,
                    avatarDisplay: p.avatarDisplay || p.avatar_display,
                    isLocal: p.isLocal ?? p.id === currentUser?.id,
                    isMuted: p.isMuted ?? false,
                    isDeafened: p.isDeafened ?? false,
                    isSpeaking: false,
                    isRinging: isRingingOutgoing && p.id !== currentUser?.id,
                    isInVoice: p.isInVoice ?? true,
                    isReconnecting: p.isReconnecting ?? false,
                  }
                : p;
              const src = item.avatar
                ? getAuthAssetUrl(item.avatar)
                : undefined;
              const isCalling =
                item.isRinging || (isRingingIncoming && !item.isLocal);
              const status = item.isLocal
                ? "You"
                : isLobby && isRingingOutgoing
                  ? "Calling…"
                  : isLobby && isRingingIncoming
                    ? "is calling…"
                    : isLobby && isActive
                      ? item.isReconnecting
                        ? "Reconnecting"
                        : item.isInVoice
                          ? "In voice"
                          : "Not in voice"
                      : null;
              return (
                <li
                  key={item.id}
                  className="flex w-24 flex-col items-center md:w-32"
                >
                  <div className="relative size-24 md:size-32">
                    {isCalling && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-full border-2 border-rm-status-online/60 animate-ring-ping motion-reduce:hidden"
                      />
                    )}
                    <div
                      className={cn(
                        "relative h-full w-full overflow-visible rounded-full bg-rm-tint-2",
                        item.isSpeaking && "ring-2 ring-rm-status-online",
                        isLobby &&
                          item.isReconnecting &&
                          "opacity-45 grayscale",
                        isLobby &&
                          !item.isLocal &&
                          !item.isInVoice &&
                          !item.isRinging &&
                          !isRingingIncoming &&
                          "opacity-45",
                        isCalling && "opacity-60",
                      )}
                    >
                      {src ? (
                        <AvatarImage
                          src={src}
                          alt={item.name}
                          display={
                            item.avatarDisplay ?? item.avatar_display ?? null
                          }
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center rounded-full text-ui-2xl font-semibold text-rm-text">
                          {item.name?.[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>

                    {(item.isMuted || item.isDeafened) && (
                      <div className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-rm-bg-surface text-rm-danger-ink ring-2 ring-rm-bg-primary">
                        <Icon
                          name={item.isDeafened ? "deafen" : "mic"}
                          state="off"
                          size="sm"
                          label={item.isDeafened ? "Deafened" : "Muted"}
                        />
                      </div>
                    )}
                  </div>

                  <p className="mt-3 w-full truncate text-center text-ui-sm font-semibold text-rm-text">
                    <InlineEmojiText text={item.name} />
                  </p>
                  {status && (
                    <p className="text-center text-ui-xs text-rm-text-secondary">
                      {status}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Dock: the shared voice dock in the call, lobby actions before. */}
      <div
        className={cn(
          "shrink-0",
          showVideoStage && "border-t border-rm-border bg-rm-bg-surface",
          isExpanded && "pb-[var(--safe-area-bottom,0px)]",
        )}
      >
        {isActive && hasJoinedSFU && (
          <VoiceControls
            hasMicrophone={callVoice.hasMicrophone ?? true}
            isMicOn={callVoice.isMicOn}
            toggleMic={() => callVoice.toggleMic?.()}
            isDeafened={isDeafened}
            toggleDeafen={() => callVoice.toggleDeafen?.()}
            hasCamera={callVoice.hasCamera ?? true}
            isCameraOn={callVoice.isCameraActive}
            toggleCamera={() => callVoice.toggleCamera?.()}
            isScreenSharing={callVoice.isScreenSharing}
            toggleScreenShare={callVoice.toggleScreenShare || (() => {})}
            setIsScreenModalOpen={setIsScreenModalOpen}
            focusedItem={displayItems.find((i: any) => i.id === focusedId)}
            setFocusedId={setFocusedId}
            handleLeave={handleLeave}
            isFullscreen={isExpanded}
            toggleFs={() => setIsExpanded(!isExpanded)}
            fullscreenSupported
            showMembers={showMembers}
            setShowMembers={setShowMembers}
            variant="call"
            hideExtraControls={!hasVideoFeed}
            isChatHidden={isChatHidden}
            toggleChatHidden={() => setIsChatHidden(!isChatHidden)}
            settingsUserId={currentUser?.id}
          />
        )}

        {!hasJoinedSFU &&
          (isActive || isRingingIncoming || isRingingOutgoing) && (
            <div className="flex items-center justify-center gap-2 px-4 pt-1 pb-4">
              {isRingingOutgoing ? (
                <IconButton
                  variant="plain"
                  size="lg"
                  icon="close"
                  tooltip="Cancel call"
                  className={DOCK_LEAVE}
                  onClick={handleCancelCall}
                />
              ) : (
                <>
                  <DockButton
                    state="rest"
                    icon="camera"
                    tooltip="Join with video"
                    onClick={handleAcceptWithVideo}
                  />
                  <IconButton
                    variant="plain"
                    size="lg"
                    icon="call"
                    iconState="active"
                    tooltip="Join voice"
                    className={CALL_ACCEPT}
                    onClick={(event) => handleAccept(getEventEpochMs(event))}
                  />
                  {isRingingIncoming && (
                    // One solid fill per surface (1.1): Join voice keeps the
                    // success fill, Decline is the destructive tint (13.2).
                    <IconButton
                      variant="plain"
                      size="lg"
                      icon="close"
                      tooltip="Decline"
                      className={DOCK_DESTRUCTIVE}
                      onClick={handleDecline}
                    />
                  )}
                </>
              )}
            </div>
          )}
      </div>

      {/* Screen share modal: desktop gets the custom picker, web gets quality-only */}
      <Suspense fallback={null}>
        <UnifiedScreenShareModal
          isOpen={isScreenModalOpen}
          onClose={() => setIsScreenModalOpen(false)}
          onStart={(options) => {
            callVoice.toggleScreenShare?.({
              ...options,
              changeSource: callVoice.isScreenSharing,
            });
            setIsScreenModalOpen(false);
          }}
          availableQualities={getAvailableStreamQualities()}
        />
      </Suspense>
    </section>
  );
}
