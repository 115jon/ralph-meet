import { AvatarImage } from "@/components/chat/AvatarImage";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { clog } from "@/lib/console-logger";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import type { ListenTogetherPlaybackState } from "./listen-together-playback";
import { formatListenTogetherDuration } from "./listen-together-playback";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS } from "@/components/ui/interaction";
import { LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS } from "@/lib/voice/listen-together-audio";
import { useEffect, useRef } from "react";

const listenTogetherLog = clog("ListenTogether");

function isCurrentSeekPreview(
  playback: ListenTogetherPlaybackState["localPlayback"],
  pendingSeek: { entryId: string; positionMs: number },
) {
  return (
    playback?.entryId === pendingSeek.entryId &&
    playback.source === "seek" &&
    playback.positionMs === pendingSeek.positionMs
  );
}

interface ListenTogetherNowPlayingCardProps {
  playback: ListenTogetherPlaybackState;
  sfu: SFUClient | null;
  roomSlug?: string | null;
  variant?: "mini" | "panel";
  onOpenQueue?: () => void;
  className?: string;
}

export function ListenTogetherNowPlayingCard({
  playback,
  sfu,
  roomSlug,
  variant = "mini",
  onOpenQueue,
  className,
}: ListenTogetherNowPlayingCardProps) {
  const {
    currentEntry,
    durationMs,
    effectiveSeekValue,
    error,
    localVolume,
    loudnessEnabled,
    loudnessPreset,
    progressMax,
    setLocalVolume,
    setLocalPlayback,
    updateLoudnessSettings,
    snapshot,
    isPaused,
    localPlayback,
  } = playback;

  const canControl = !!roomSlug && !!sfu && sfu.voiceGW.isReady !== false;
  const pendingSeekRef = useRef<{
    entryId: string;
    positionMs: number;
    previousPlayback: typeof localPlayback;
  } | null>(null);
  const localPlaybackRef = useRef(localPlayback);

  useEffect(() => {
    pendingSeekRef.current = null;
  }, [currentEntry?.entryId, roomSlug]);
  useEffect(() => {
    localPlaybackRef.current = localPlayback;
  }, [localPlayback]);

  if (!currentEntry) {
    if (variant === "mini") return null;
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-3 px-6 py-12 text-center",
          className,
        )}
      >
        <Icon
          name="headphones"
          size="3xl"
          className="text-rm-text-muted max-md:size-8"
        />
        <p className="text-ui-md font-semibold text-rm-text">Nothing playing</p>
        <p className="max-w-[36ch] text-pretty text-ui-sm text-rm-text-secondary">
          Queue a track to start listening together.
        </p>
      </div>
    );
  }

  const queueCount = snapshot?.queue?.length ?? 0;
  const subtitle =
    [
      currentEntry.track.artist,
      currentEntry.track.kind === "music" ? currentEntry.track.album : null,
    ]
      .filter(Boolean)
      .join(" • ") || currentEntry.track.sourceLabel;
  const requesterLine =
    queueCount > 1
      ? `Requested by ${currentEntry.requester.displayName} • ${queueCount} queued`
      : `Requested by ${currentEntry.requester.displayName}`;
  const syncBadge = error
    ? {
        label: "Issue",
        className: "bg-rm-danger-tint text-rm-danger-ink",
      }
    : isPaused
      ? {
          label: "Paused",
          className: "bg-rm-tint-2 text-rm-text-secondary",
        }
      : {
          label: "Sync",
          className: "bg-rm-accent-tint text-rm-accent-ink",
        };

  const artwork = currentEntry.track.artworkUrl ? (
    <img
      src={currentEntry.track.artworkUrl}
      alt={`${currentEntry.track.title} artwork`}
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
      <Icon name="headphones" size={variant === "mini" ? "sm" : "lg"} />
    </div>
  );

  const requesterAvatar = currentEntry.requester.avatarUrl ? (
    <AvatarImage
      src={getAuthAssetUrl(currentEntry.requester.avatarUrl)}
      alt={`${currentEntry.requester.displayName} avatar`}
      display={currentEntry.requester.avatarDisplay}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-ui-2xs font-bold text-rm-text-muted">
      {currentEntry.requester.displayName.charAt(0).toUpperCase()}
    </div>
  );
  const titleTriggerClassName = cn(
    "block truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-rm-bg-elevated",
    variant === "mini"
      ? "text-ui-sm font-semibold leading-tight text-rm-text"
      : "text-ui-md font-semibold text-rm-text",
  );

  const sendCommand = (payload: Record<string, unknown>) => {
    if (!sfu || !roomSlug || sfu.voiceGW.isReady === false) return false;
    listenTogetherLog.info("Sending listen together control", {
      source: "now-playing-card",
      type: payload.type,
      roomSlug,
      paused: payload.paused ?? null,
      entryId: payload.entryId ?? null,
    });
    sfu.resumeAudioContext?.();
    const accepted = sfu.voiceGW.sendAppEvent(payload);
    if (
      accepted &&
      payload.type === "listen_together.pause" &&
      typeof payload.paused === "boolean"
    ) {
      const previousCommandStates =
        localPlayback?.source === "command"
          ? (localPlayback.pendingStates ?? [])
          : [];
      const nextSequence = (previousCommandStates.at(-1)?.sequence ?? 0) + 1;
      const nextSnapshotRevision =
        (snapshot?.revision ?? 0) + previousCommandStates.length;
      setLocalPlayback(roomSlug, {
        paused: payload.paused,
        positionMs: effectiveSeekValue,
        entryId: currentEntry.entryId,
        snapshotRevision: nextSnapshotRevision,
        source: "command",
        accepted: true,
        pendingStates: [
          ...previousCommandStates,
          {
            paused: payload.paused,
            positionMs: effectiveSeekValue,
            snapshotRevision: nextSnapshotRevision,
            sequence: nextSequence,
          },
        ],
      });
    }
    return accepted;
  };

  const updateSeekPreview = (positionMs: number) => {
    pendingSeekRef.current ??= {
      entryId: currentEntry.entryId,
      positionMs,
      previousPlayback: localPlayback,
    };
    pendingSeekRef.current.positionMs = positionMs;
    if (!roomSlug) return;
    const preview = {
      paused: isPaused,
      positionMs,
      entryId: currentEntry.entryId,
      snapshotRevision: snapshot?.revision ?? 0,
      source: "seek",
      accepted: false,
    } as const;
    localPlaybackRef.current = preview;
    setLocalPlayback(roomSlug, preview);
  };

  const commitSeek = () => {
    const pendingSeek = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (!pendingSeek || pendingSeek.entryId !== currentEntry.entryId) {
      return;
    }

    const accepted = sendCommand({
      type: "listen_together.seek",
      room_slug: roomSlug,
      positionMs: pendingSeek.positionMs,
      entryId: pendingSeek.entryId,
    });
    if (roomSlug) {
      const rollbackPlayback =
        pendingSeek.previousPlayback &&
        snapshot &&
        pendingSeek.previousPlayback.snapshotRevision < snapshot.revision
          ? null
          : pendingSeek.previousPlayback;
      if (accepted) {
        setLocalPlayback(roomSlug, {
          paused: isPaused,
          positionMs: pendingSeek.positionMs,
          entryId: pendingSeek.entryId,
          snapshotRevision: snapshot?.revision ?? 0,
          source: "seek",
          accepted: true,
        });
      } else if (isCurrentSeekPreview(localPlaybackRef.current, pendingSeek)) {
        localPlaybackRef.current = rollbackPlayback;
        setLocalPlayback(roomSlug, rollbackPlayback);
      }
    }
  };

  const cancelSeek = () => {
    const pendingSeek = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (
      pendingSeek &&
      roomSlug &&
      isCurrentSeekPreview(localPlaybackRef.current, pendingSeek)
    ) {
      const rollbackPlayback =
        pendingSeek.previousPlayback &&
        snapshot &&
        pendingSeek.previousPlayback.snapshotRevision < snapshot.revision
          ? null
          : pendingSeek.previousPlayback;
      localPlaybackRef.current = rollbackPlayback;
      setLocalPlayback(roomSlug, rollbackPlayback);
    }
  };

  const handleSeekKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelSeek();
  };

  const handleSeekKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown" ||
      event.key === "Enter"
    ) {
      commitSeek();
    }
  };

  if (variant === "mini") {
    return (
      <TooltipProvider delayDuration={100}>
        <div
          className={cn(
            "rounded-xl border border-rm-border bg-rm-bg-surface px-3 py-3 dark:bg-rm-bg-elevated max-md:px-2.5 max-md:py-2.5",
            className,
          )}
        >
          <div className="flex items-start gap-3 max-md:items-center max-md:gap-2.5">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-rm-tint-1 max-md:h-10 max-md:w-10">
              {artwork}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className={titleTriggerClassName}
                        aria-label={`Track title: ${currentEntry.track.title}`}
                      >
                        {currentEntry.track.title}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="start"
                      sideOffset={10}
                      className="max-w-[280px]"
                    >
                      <p className="break-words text-ui-sm font-semibold">
                        {currentEntry.track.title}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <div className="mt-1 truncate text-ui-2xs text-rm-text-muted">
                    {subtitle}
                  </div>
                </div>
                <div
                  className={cn(
                    "inline-flex shrink-0 rounded-full px-2 py-0.5 text-ui-2xs font-semibold",
                    syncBadge.className,
                    "max-md:hidden",
                  )}
                >
                  {syncBadge.label}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-ui-2xs text-rm-text-muted max-md:hidden">
                <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-rm-tint-2">
                  {requesterAvatar}
                </div>
                <InlineEmojiText text={requesterLine} className="truncate" />
              </div>
            </div>
          </div>
          <div className="mt-3 max-md:mt-2">
            <div className="flex items-center gap-2">
              <span className="min-w-9 text-ui-2xs text-rm-text-muted tabular-nums">
                {formatListenTogetherDuration(effectiveSeekValue)}
              </span>
              <input
                type="range"
                min={0}
                max={progressMax}
                value={Math.min(effectiveSeekValue, progressMax)}
                disabled={!canControl}
                aria-label={`Seek ${currentEntry.track.title}`}
                onChange={(event) => {
                  updateSeekPreview(Number(event.currentTarget.value));
                }}
                onPointerUp={commitSeek}
                onPointerCancel={cancelSeek}
                onKeyDown={handleSeekKeyDown}
                onKeyUp={handleSeekKeyUp}
                onBlur={commitSeek}
                className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
              />
              <span className="min-w-9 text-right text-ui-2xs text-rm-text-muted tabular-nums">
                {formatListenTogetherDuration(durationMs)}
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            {onOpenQueue ? (
              <button
                type="button"
                onClick={onOpenQueue}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-full bg-rm-tint-1 px-3 text-ui-xs font-medium text-rm-text-secondary outline-none pointer-fine:hover:text-rm-text max-md:w-8 max-md:justify-center max-md:gap-0 max-md:px-0",
                  PRESS,
                  HIT,
                )}
                aria-label="Open listen together queue"
              >
                <Icon name="playlist" size="sm" />
                <span className="max-md:hidden">
                  {queueCount > 0 ? `Queue ${queueCount}` : "Open queue"}
                </span>
              </button>
            ) : (
              <div className="text-ui-2xs text-rm-text-muted">
                {currentEntry.track.sourceLabel}
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1 max-md:gap-1.5">
              <IconButton
                icon={isPaused ? "play" : "pause"}
                iconSize="sm"
                variant="muted"
                shape="circle"
                className="bg-rm-tint-1"
                onClick={() => {
                  sendCommand({
                    type: "listen_together.pause",
                    room_slug: roomSlug,
                    paused: !isPaused,
                    entryId: currentEntry.entryId,
                  });
                }}
                disabled={!canControl}
                aria-label={
                  isPaused ? "Resume shared playback" : "Pause shared playback"
                }
              />
              <IconButton
                icon="skip"
                iconSize="sm"
                variant="muted"
                shape="circle"
                className="bg-rm-tint-1"
                onClick={() => {
                  sendCommand({
                    type: "listen_together.skip",
                    room_slug: roomSlug,
                    entryId: currentEntry.entryId,
                  });
                }}
                disabled={!canControl}
                aria-label="Skip current track"
              />
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("space-y-4", className)}>
        <div className="flex gap-4 md:gap-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-rm-tint-1 md:h-24 md:w-24">
            {artwork}
          </div>
          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className={titleTriggerClassName}
                      aria-label={`Track title: ${currentEntry.track.title}`}
                    >
                      {currentEntry.track.title}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    sideOffset={10}
                    className="max-w-[320px]"
                  >
                    <p className="break-words text-ui-sm font-semibold">
                      {currentEntry.track.title}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <div className="mt-1 truncate text-ui-xs text-rm-text-muted md:text-ui-sm">
                  {subtitle}
                </div>
              </div>
              {queueCount > 0 && (
                <span className="shrink-0 rounded-full bg-rm-accent-tint px-2 py-0.5 text-ui-2xs font-semibold tabular-nums text-rm-accent-ink">
                  {queueCount} queued
                </span>
              )}
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2 text-ui-xs text-rm-text-muted">
              <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-rm-tint-2">
                {requesterAvatar}
              </div>
              <InlineEmojiText text={requesterLine} className="truncate" />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={progressMax}
            value={Math.min(effectiveSeekValue, progressMax)}
            disabled={!canControl}
            aria-label={`Seek ${currentEntry.track.title}`}
            onChange={(event) => {
              updateSeekPreview(Number(event.currentTarget.value));
            }}
            onPointerUp={commitSeek}
            onPointerCancel={cancelSeek}
            onKeyDown={handleSeekKeyDown}
            onKeyUp={handleSeekKeyUp}
            onBlur={commitSeek}
            className="h-8 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between text-ui-2xs tabular-nums text-rm-text-muted">
            <span>{formatListenTogetherDuration(effectiveSeekValue)}</span>
            <span>{formatListenTogetherDuration(durationMs)}</span>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm text-rm-danger-ink">
            <Icon name="warning" size="sm" className="mt-0.5 shrink-0" />
            {error.message}
          </div>
        )}

        <div className="flex items-center justify-center gap-2 md:justify-start">
          <Button
            size="lg"
            className="size-11 rounded-full px-0"
            onClick={() => {
              sendCommand({
                type: "listen_together.pause",
                room_slug: roomSlug,
                paused: !isPaused,
                entryId: currentEntry.entryId,
              });
            }}
            disabled={!canControl}
            aria-label={
              isPaused ? "Resume shared playback" : "Pause shared playback"
            }
          >
            <Icon name={isPaused ? "play" : "pause"} size="lg" />
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="rounded-full"
            onClick={() => {
              sendCommand({
                type: "listen_together.skip",
                room_slug: roomSlug,
                entryId: currentEntry.entryId,
              });
            }}
            disabled={!canControl}
          >
            <Icon name="skip" size="sm" />
            Skip
          </Button>
          <IconButton
            icon="trash"
            size="md"
            variant="destructive"
            shape="circle"
            className="ml-auto md:ml-2"
            onClick={() => {
              sendCommand({
                type: "listen_together.remove",
                room_slug: roomSlug,
                entryId: currentEntry.entryId,
              });
            }}
            disabled={!canControl}
            aria-label="Remove current track"
          />
        </div>

        <div className="flex min-h-11 items-center gap-3 border-t border-rm-border pt-3">
          <Icon
            name="voiceChannel"
            size="sm"
            className="shrink-0 text-rm-text-muted"
          />
          <label className="sr-only" htmlFor="listen-together-volume">
            Your volume
          </label>
          <input
            id="listen-together-volume"
            type="range"
            min={0}
            max={100}
            value={Math.round(localVolume * 100)}
            disabled={!roomSlug}
            aria-valuetext={`${Math.round(localVolume * 100)} percent local volume`}
            onChange={(event) => {
              if (!roomSlug) return;
              setLocalVolume(roomSlug, Number(event.currentTarget.value) / 100);
            }}
            className="h-8 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
          <span className="min-w-9 text-right text-ui-xs tabular-nums text-rm-text-muted">
            {Math.round(localVolume * 100)}%
          </span>
          <details className="relative shrink-0">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md text-rm-text-muted outline-none transition-colors duration-150 pointer-fine:hover:bg-rm-tint-2 pointer-fine:hover:text-rm-text [&::-webkit-details-marker]:hidden">
              <Icon name="privacy" size="sm" />
              <span className="sr-only">Audio options</span>
            </summary>
            <div className="absolute bottom-12 right-0 z-20 w-56 rounded-lg border border-rm-border bg-rm-bg-floating p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-ui-xs font-semibold text-rm-text">
                    Loudness
                  </div>
                  <div className="text-ui-2xs text-rm-text-muted">
                    Smooth out big volume changes.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={loudnessEnabled}
                  aria-label={
                    loudnessEnabled
                      ? "Turn off loudness control"
                      : "Turn on loudness control"
                  }
                  onClick={() =>
                    updateLoudnessSettings({ enabled: !loudnessEnabled })
                  }
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150",
                    HIT,
                    loudnessEnabled ? "bg-primary" : "bg-rm-field-edge",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-(--rm-ease-out)",
                      loudnessEnabled ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-rm-tint-1 p-1">
                {LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS.map(
                  ([preset, { label }]) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={!loudnessEnabled}
                      aria-label={`Use ${label.toLowerCase()} loudness control`}
                      aria-pressed={loudnessPreset === preset}
                      onClick={() => updateLoudnessSettings({ preset })}
                      className={cn(
                        "min-w-0 flex-1 rounded-sm px-2 py-1.5 text-ui-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
                        loudnessPreset === preset
                          ? "bg-rm-tint-3 font-semibold text-rm-text"
                          : "text-rm-text-muted pointer-fine:hover:text-rm-text",
                      )}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </div>
          </details>
        </div>

        <div className="flex items-center justify-between gap-3 text-ui-2xs text-rm-text-muted">
          <span className="truncate">{currentEntry.track.sourceLabel}</span>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-rm-text-secondary"
            onClick={() => {
              sendCommand({
                type: "listen_together.clear",
                room_slug: roomSlug,
              });
            }}
            disabled={!canControl}
          >
            Clear queue
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
