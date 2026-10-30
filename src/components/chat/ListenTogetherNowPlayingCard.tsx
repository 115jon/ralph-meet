import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { clog } from "@/lib/console-logger";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { describeListenTogetherError } from "@/lib/listen-together";
import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import {
  formatListenTogetherDuration,
  getListenTogetherLivePositionMs,
  getListenTogetherProgressKey,
  isListenTogetherProgressRunning,
  type ListenTogetherPlaybackState,
  type ListenTogetherPositionSource,
  useListenTogetherClockNow,
} from "./listen-together-playback";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Led, type LedState } from "@/components/ui/led";
import { formatElapsed, Num } from "@/components/ui/num";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useAppActive } from "@/hooks/useAppActive";
import { LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS } from "@/lib/voice/listen-together-audio";
import { useEffect, useRef, useState } from "react";

import { RangeSlider } from "./floating/RangeSlider";

const listenTogetherLog = clog("ListenTogether");

/* ------------------------------------------------------------------ */
/* Progress: CSS-driven, re-keyed only when the position jumps          */
/* ------------------------------------------------------------------ */

const PROGRESS_KEYFRAMES =
  "@keyframes rm-listen-progress{from{transform:translateX(-100%)}to{transform:translateX(0)}}";

/** One shared keyframe; React hoists it into <head> and dedupes it. */
function ProgressKeyframes() {
  return (
    <style href="rm-listen-progress" precedence="default">
      {PROGRESS_KEYFRAMES}
    </style>
  );
}

const PROGRESS_TONE = {
  /** Seek bars: the spec slider (tint-3 track, primary-fill, 14px thumb). */
  control: {
    track: "h-1 bg-tint-3",
    fill: "bg-primary-fill",
    marker: "size-3.5 bg-primary-fill ring-2 ring-ply-3",
  },
  /** Tracklist rows: the lit path along a guide, ending in a node. */
  path: {
    track: "h-0.5 bg-guide",
    fill: "bg-path",
    marker: "size-1.5 bg-path",
  },
} as const;

/**
 * How far the shared track has played, moved by one linear CSS animation
 * (`transform` only): duration = the track, a negative delay = time already
 * played, paused with `animation-play-state`. Nothing re-renders while it
 * runs; seek, pause, resume, the next track or the app coming back re-key it.
 * The global `data-app-inactive` rule pauses it.
 */
export function ListenTogetherProgress({
  playback,
  tone = "control",
  marker = false,
  className,
}: {
  playback: ListenTogetherPositionSource;
  tone?: keyof typeof PROGRESS_TONE;
  marker?: boolean;
  className?: string;
}) {
  const active = useAppActive();
  if (playback.durationMs <= 0) return null;
  const key = `${getListenTogetherProgressKey(playback)}|${active ? "on" : "off"}`;
  return (
    <div
      aria-hidden
      data-slot="listen-progress"
      className={cn(
        "pointer-events-none relative w-full rounded-full",
        PROGRESS_TONE[tone].track,
        className,
      )}
    >
      <ProgressKeyframes />
      <ProgressRun key={key} playback={playback} tone={tone} marker={marker} />
    </div>
  );
}

function ProgressRun({
  playback,
  tone,
  marker,
}: {
  playback: ListenTogetherPositionSource;
  tone: keyof typeof PROGRESS_TONE;
  marker: boolean;
}) {
  // Read once per key: changing the delay of a running animation would
  // count the elapsed time twice.
  const [animation] = useState(() => {
    const position = getListenTogetherLivePositionMs(playback, Date.now());
    const state = isListenTogetherProgressRunning(playback)
      ? "running"
      : "paused";
    return `rm-listen-progress ${playback.durationMs}ms linear ${-position}ms 1 normal both ${state}`;
  });
  return (
    <>
      <span className="absolute inset-0 overflow-hidden rounded-full">
        <span
          className={cn("absolute inset-0", PROGRESS_TONE[tone].fill)}
          style={{ animation }}
        />
      </span>
      {marker ? (
        <span className="absolute inset-0" style={{ animation }}>
          <span
            className={cn(
              "absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 rounded-full",
              PROGRESS_TONE[tone].marker,
            )}
          />
        </span>
      ) : null}
    </>
  );
}

/** Elapsed time, ticking once a second in its own leaf while on screen. */
export function ListenTogetherClock({
  playback,
  className,
}: {
  playback: ListenTogetherPositionSource;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const now = useListenTogetherClockNow(playback, ref);
  return (
    <Num ref={ref} className={className}>
      {formatElapsed(getListenTogetherLivePositionMs(playback, now))}
    </Num>
  );
}

/**
 * Seek: a native range input (keyboard, Escape to cancel) laid invisibly
 * over the CSS progress. The input and the elapsed label update at 1 Hz in
 * this leaf only.
 */
function SeekBar({
  playback,
  title,
  disabled,
  layout,
  onPreview,
  onCommit,
  onCancel,
  onKeyDown,
  onKeyUp,
}: {
  playback: ListenTogetherPlaybackState;
  title: string;
  disabled: boolean;
  layout: "inline" | "stacked";
  onPreview: (positionMs: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const now = useListenTogetherClockNow(playback, ref);
  const position = getListenTogetherLivePositionMs(playback, now);
  const max = playback.progressMax;
  const elapsed = formatElapsed(position);
  const total = formatListenTogetherDuration(playback.durationMs);

  const track = (
    <div className="group/seek relative flex h-5 min-w-0 flex-1 items-center rounded-sm has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus pointer-coarse:h-11">
      <ListenTogetherProgress playback={playback} marker />
      <input
        type="range"
        min={0}
        max={max}
        value={Math.min(position, max)}
        disabled={disabled}
        aria-label={`Seek ${title}`}
        aria-valuetext={`${elapsed} of ${total}`}
        onChange={(event) => onPreview(Number(event.currentTarget.value))}
        onPointerUp={onCommit}
        onPointerCancel={onCancel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={onCommit}
        className="absolute inset-0 m-0 h-full w-full min-w-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </div>
  );

  if (layout === "inline") {
    return (
      <div ref={ref} className="flex items-center gap-2">
        <Num className="min-w-9 text-ink-3">{elapsed}</Num>
        {track}
        <Num className="min-w-9 text-right text-ink-3">{total}</Num>
      </div>
    );
  }
  return (
    <div ref={ref} className="flex flex-col gap-1">
      {track}
      <div className="flex items-center justify-between text-ink-3">
        <Num>{elapsed}</Num>
        <Num>{total}</Num>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                 */
/* ------------------------------------------------------------------ */

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
  /**
   * mini: the floating player body. pill: the phone's compact player (art,
   * title, play/pause). panel: the full card (queue panel, phone sheet).
   */
  variant?: "mini" | "pill" | "panel";
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
    error,
    localVolume,
    loudnessEnabled,
    loudnessPreset,
    setLocalVolume,
    setLocalPlayback,
    updateLoudnessSettings,
    snapshot,
    isPaused,
    localPlayback,
  } = playback;

  const canControl = !!roomSlug && !!sfu && sfu.voiceGW.isReady !== false;
  const [confirmClear, setConfirmClear] = useState(false);
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
    if (variant !== "panel") return null;
    return (
      <EmptyState
        className={className}
        title="Nothing playing"
        description="Queue a track to start listening together."
      />
    );
  }

  const queueCount = snapshot?.queue?.length ?? 0;
  const subtitle =
    [
      currentEntry.track.artist,
      currentEntry.track.kind === "music" ? currentEntry.track.album : null,
    ]
      .filter(Boolean)
      .join(" · ") || currentEntry.track.sourceLabel;
  // The queue count shows once: on the queue button (mini) or the Queue tab.
  const requesterLine = `Requested by ${currentEntry.requester.displayName}`;
  const status: {
    label: string;
    led: LedState;
    className: string;
    normal?: boolean;
  } = error
    ? { label: "Issue", led: "muted", className: "text-danger-ink" }
    : !canControl
      ? { label: "Not connected", led: "off", className: "text-ink-3" }
      : isPaused
        ? { label: "Paused", led: "off", className: "text-ink-3" }
        : {
            label: "In sync",
            led: "talk",
            className: "text-ink-3",
            normal: true,
          };

  const artwork = currentEntry.track.artworkUrl ? (
    <img
      src={currentEntry.track.artworkUrl}
      alt={`${currentEntry.track.title} artwork`}
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-ink-3">
      <Icon name="music" size={variant === "panel" ? "lg" : "md"} />
    </div>
  );

  const requesterAvatar = currentEntry.requester.avatarUrl ? (
    <AvatarImage
      src={getAuthAssetUrl(currentEntry.requester.avatarUrl)}
      alt={`${currentEntry.requester.displayName} avatar`}
      display={currentEntry.requester.avatarDisplay}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-ui-2xs text-ink-3">
      {currentEntry.requester.displayName.charAt(0).toUpperCase()}
    </div>
  );
  const requester = (
    <div className="flex min-w-0 items-center gap-1.5 text-ui-xs text-ink-3">
      <div
        className={cn(
          "size-4 shrink-0 bg-tint-3",
          avatarShape(
            currentEntry.requester.avatarUrl &&
              currentEntry.requester.avatarDisplay,
          ),
        )}
      >
        {requesterAvatar}
      </div>
      <InlineEmojiText
        text={requesterLine}
        className="block min-w-0 truncate"
      />
    </div>
  );
  const titleTriggerClassName = cn(
    "block truncate rounded-xs text-ink-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    variant === "mini"
      ? "text-ui-row font-medium"
      : "text-ui-md font-semibold text-balance",
  );
  const title = (
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
        className="max-w-80"
      >
        <p className="break-words">{currentEntry.track.title}</p>
      </TooltipContent>
    </Tooltip>
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
      // The live position at the click, not the last render's.
      const positionMs = getListenTogetherLivePositionMs(playback, Date.now());
      const previousCommandStates =
        localPlayback?.source === "command"
          ? (localPlayback.pendingStates ?? [])
          : [];
      const nextSequence = (previousCommandStates.at(-1)?.sequence ?? 0) + 1;
      const nextSnapshotRevision =
        (snapshot?.revision ?? 0) + previousCommandStates.length;
      setLocalPlayback(roomSlug, {
        paused: payload.paused,
        positionMs,
        entryId: currentEntry.entryId,
        snapshotRevision: nextSnapshotRevision,
        source: "command",
        accepted: true,
        pendingStates: [
          ...previousCommandStates,
          {
            paused: payload.paused,
            positionMs,
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

  const togglePause = () => {
    sendCommand({
      type: "listen_together.pause",
      room_slug: roomSlug,
      paused: !isPaused,
      entryId: currentEntry.entryId,
    });
  };
  const skip = () => {
    sendCommand({
      type: "listen_together.skip",
      room_slug: roomSlug,
      entryId: currentEntry.entryId,
    });
  };
  const pauseLabel = isPaused
    ? "Resume shared playback"
    : "Pause shared playback";

  const seek = (layout: "inline" | "stacked") => (
    <SeekBar
      playback={playback}
      title={currentEntry.track.title}
      disabled={!canControl}
      layout={layout}
      onPreview={updateSeekPreview}
      onCommit={commitSeek}
      onCancel={cancelSeek}
      onKeyDown={handleSeekKeyDown}
      onKeyUp={handleSeekKeyUp}
    />
  );

  const statusChip = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-ui-xs",
        status.className,
      )}
    >
      <Led state={status.led} />
      {status.label}
    </span>
  );

  if (variant === "pill") {
    return (
      <div
        className={cn(
          "relative flex h-14 items-center gap-3 pr-1.5 pl-2",
          className,
        )}
      >
        <div className="size-10 shrink-0 overflow-hidden rounded-md bg-tint-1">
          {artwork}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-sm font-medium text-ink-1">
            {currentEntry.track.title}
          </p>
          <p className="truncate text-ui-xs text-ink-3">
            {isPaused ? "Paused" : subtitle}
          </p>
        </div>
        <IconButton
          icon={isPaused ? "play" : "pause"}
          iconState="active"
          size={40}
          shape="circle"
          onClick={togglePause}
          disabled={!canControl}
          aria-label={pauseLabel}
        />
        {/* Progress as a hairline along the bottom edge; the sheet seeks. */}
        <ListenTogetherProgress
          playback={playback}
          className="absolute inset-x-0 bottom-0 h-0.5 rounded-none bg-transparent"
        />
      </div>
    );
  }

  if (variant === "mini") {
    return (
      <TooltipProvider>
        <div className={cn("flex flex-col gap-3 p-3", className)}>
          <div className="flex items-start gap-3">
            <div className="size-12 shrink-0 overflow-hidden rounded-md bg-tint-1">
              {artwork}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <div className="min-w-0 flex-1">{title}</div>
                <span className="max-md:hidden">{statusChip}</span>
              </div>
              <div className="truncate text-ui-xs text-ink-3">{subtitle}</div>
              <div className="mt-1 max-md:hidden">{requester}</div>
            </div>
          </div>
          {seek("inline")}
          <div className="flex items-center justify-between gap-2">
            {onOpenQueue ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenQueue}
                aria-label="Open listen together queue"
              >
                <Icon name="playlist" size="sm" />
                {queueCount > 0 ? (
                  <>
                    Queue <Num className="text-ink-3">{queueCount}</Num>
                  </>
                ) : (
                  "Open queue"
                )}
              </Button>
            ) : (
              <span className="text-ui-xs text-ink-3">
                {currentEntry.track.sourceLabel}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                icon={isPaused ? "play" : "pause"}
                iconState="active"
                size={32}
                shape="circle"
                className="bg-tint-1"
                onClick={togglePause}
                disabled={!canControl}
                aria-label={pauseLabel}
              />
              <IconButton
                icon="skip"
                size={32}
                shape="circle"
                onClick={skip}
                disabled={!canControl}
                aria-label="Skip current track"
              />
            </div>
          </div>
          {error ? (
            <p className="flex items-start gap-1.5 text-ui-xs text-danger-ink">
              <Icon name="warning" size="xs" className="mt-0.5 shrink-0" />
              {describeListenTogetherError(error, "control playback")}
            </p>
          ) : null}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn("flex min-w-0 flex-col gap-4", className)}>
        <div className="flex min-w-0 gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-tint-1 md:size-24">
            {artwork}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
            {title}
            <div className="truncate text-ui-sm text-ink-2">{subtitle}</div>
            {/* The room's sync state already heads the panel; only say
                something here when it isn't the normal "in sync". */}
            <div className="mt-auto flex min-w-0 items-center justify-between gap-3">
              {requester}
              {status.normal ? null : statusChip}
            </div>
          </div>
        </div>

        {seek("stacked")}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-ui-sm text-danger-ink"
          >
            <Icon name="warning" size="sm" className="mt-0.5 shrink-0" />
            {describeListenTogetherError(error, "control playback")}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="lg"
            className="size-10 rounded-full px-0 has-[>svg]:px-0"
            onClick={togglePause}
            disabled={!canControl}
            aria-label={pauseLabel}
          >
            <Icon name={isPaused ? "play" : "pause"} state="active" size="lg" />
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="rounded-full"
            onClick={skip}
            disabled={!canControl}
          >
            <Icon name="skip" size="sm" />
            Skip
          </Button>
          <IconButton
            icon="trash"
            size={40}
            variant="destructive"
            shape="circle"
            className="ml-auto"
            onClick={() => {
              sendCommand({
                type: "listen_together.remove",
                room_slug: roomSlug,
                entryId: currentEntry.entryId,
              });
            }}
            disabled={!canControl}
            aria-label="Remove current track"
            tooltip="Remove from queue"
          />
        </div>

        <div className="flex min-h-10 items-center gap-3 border-t border-line pt-3">
          <Icon
            name={localVolume === 0 ? "speakerOff" : "voiceChannel"}
            size="sm"
            className="shrink-0 text-ink-3"
          />
          <RangeSlider
            id="listen-together-volume"
            aria-label="Your volume"
            aria-valuetext={`${Math.round(localVolume * 100)} percent local volume`}
            value={Math.round(localVolume * 100)}
            disabled={!roomSlug}
            onValueChange={(value) => {
              if (!roomSlug) return;
              setLocalVolume(roomSlug, value / 100);
            }}
            className="flex-1"
          />
          <Num className="min-w-9 text-right text-ink-3">
            {Math.round(localVolume * 100)}%
          </Num>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-ink-2 data-popup-open:bg-tint-2"
                />
              }
            >
              <Icon name="sliders" size="sm" />
              Loudness
            </PopoverTrigger>
            {/* Stacked: the panel variant also lives in the phone sheet. */}
            <PopoverContent
              side="top"
              align="end"
              stacked
              aria-label="Loudness"
              className="w-60 p-3"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-ui-sm font-medium text-ink-1">
                    Even out loudness
                  </div>
                  <div className="text-ui-xs text-ink-3">
                    Smooths big jumps between tracks. Only you hear this.
                  </div>
                </div>
                <Switch
                  checked={loudnessEnabled}
                  onCheckedChange={(enabled) =>
                    updateLoudnessSettings({ enabled })
                  }
                  aria-label={
                    loudnessEnabled
                      ? "Turn off loudness control"
                      : "Turn on loudness control"
                  }
                  className="mt-0.5"
                />
              </div>
              <div className="flex items-center gap-1 rounded-md bg-tint-1 p-1">
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
                        "h-7 min-w-0 flex-1 rounded-sm px-2 text-ui-xs font-medium outline-none transition-colors duration-(--dur-1) ease-out focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45",
                        loudnessPreset === preset
                          ? "bg-tint-3 text-ink-1"
                          : "text-ink-3 pointer-fine:hover:text-ink-1",
                      )}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-ui-xs text-ink-3">
            {currentEntry.track.sourceLabel}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-ink-2"
            onClick={() => setConfirmClear(true)}
            disabled={!canControl}
          >
            Clear queue
          </Button>
        </div>
        <ConfirmDialog
          open={confirmClear}
          onOpenChange={setConfirmClear}
          title="Clear the queue?"
          description="Every queued track is removed for everyone listening in this room."
          confirmLabel="Clear queue"
          irreversible
          errorAction="clear the queue"
          onConfirm={() => {
            if (
              !sendCommand({
                type: "listen_together.clear",
                room_slug: roomSlug,
              })
            ) {
              throw new Error("Couldn't reach the voice room.");
            }
          }}
        />
      </div>
    </TooltipProvider>
  );
}
