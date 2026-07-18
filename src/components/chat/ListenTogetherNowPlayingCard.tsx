import { AvatarImage } from "@/components/chat/AvatarImage";
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
import {
  Headphones,
  ListMusic,
  Pause,
  Play,
  ShieldCheck,
  SkipForward,
  Trash2,
  Volume2,
} from "lucide-react";
import { LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS } from "@/lib/voice/listen-together-audio";

const listenTogetherLog = clog("ListenTogether");

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
  } = playback;

  const canControl = !!roomSlug && !!sfu && sfu.voiceGW.isReady !== false;

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
    if (
      payload.type === "listen_together.pause" &&
      roomSlug &&
      typeof payload.paused === "boolean"
    ) {
      setLocalPlayback(roomSlug, {
        paused: payload.paused,
        positionMs: effectiveSeekValue,
      });
    }
    sfu.voiceGW.sendAppEvent(payload);
    return true;
  };

  if (!currentEntry) {
    if (variant === "mini") return null;
    return (
      <TooltipProvider delayDuration={100}>
        <div
          className={cn(
            "rounded-[22px] border border-dashed border-rm-border bg-rm-bg-hover/30 px-4 py-10 text-center text-sm text-rm-text-muted",
            className,
          )}
        >
          Queue a track to start listening together.
        </div>
      </TooltipProvider>
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
        className: "border-destructive/20 bg-destructive/10 text-destructive",
      }
    : isPaused
      ? {
          label: "Paused",
          className: "border-border bg-muted text-muted-foreground",
        }
      : {
          label: "Sync",
          className: "border-primary/20 bg-primary/10 text-primary",
        };
  const iconButtonClass = cn(
    "inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/6 bg-rm-bg-hover/75 text-rm-text-muted transition-colors hover:bg-rm-bg-active hover:text-rm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
    !canControl && "cursor-not-allowed opacity-50",
  );

  const artwork = currentEntry.track.artworkUrl ? (
    <img
      src={currentEntry.track.artworkUrl}
      alt={`${currentEntry.track.title} artwork`}
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-rm-text-muted">
      <Headphones className={variant === "mini" ? "h-4 w-4" : "h-5 w-5"} />
    </div>
  );

  const requesterAvatar = currentEntry.requester.avatarUrl ? (
    <AvatarImage
      src={getAuthAssetUrl(currentEntry.requester.avatarUrl)}
      alt={`${currentEntry.requester.displayName} avatar`}
      display={currentEntry.requester.avatarDisplay}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-[9px] font-black text-rm-text-muted">
      {currentEntry.requester.displayName.charAt(0).toUpperCase()}
    </div>
  );
  const titleTriggerClassName = cn(
    "block truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-rm-bg-elevated",
    variant === "mini"
      ? "text-[13px] font-bold leading-tight text-rm-text"
      : "text-base font-black text-rm-text",
  );

  if (variant === "mini") {
    return (
      <TooltipProvider delayDuration={100}>
        <div
          className={cn(
            "rounded-[20px] border border-white/6 bg-rm-bg-elevated/70 px-3 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm max-md:rounded-[16px] max-md:bg-rm-bg-elevated max-md:px-2.5 max-md:py-2.5 max-md:shadow-[0_8px_20px_rgba(0,0,0,0.18)] max-md:backdrop-blur-none",
            className,
          )}
        >
          <div className="flex items-start gap-3 max-md:items-center max-md:gap-2.5">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[16px] bg-rm-bg-hover/70 ring-1 ring-white/5 max-md:h-10 max-md:w-10 max-md:rounded-[12px]">
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
                      className="max-w-[280px] bg-rm-bg-floating text-rm-text-primary"
                    >
                      <p className="break-words text-sm font-semibold">
                        {currentEntry.track.title}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <div className="mt-1 truncate text-[11px] text-rm-text-muted">
                    {subtitle}
                  </div>
                </div>
                <div
                  className={cn(
                    "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]",
                    syncBadge.className,
                    "max-md:hidden",
                  )}
                >
                  {syncBadge.label}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-rm-text-muted max-md:hidden">
                <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-rm-bg-hover">
                  {requesterAvatar}
                </div>
                <span className="truncate">{requesterLine}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 max-md:mt-2">
            <div className="flex items-center gap-2">
              <span className="min-w-[34px] text-[10px] text-rm-text-muted/75 tabular-nums">
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
                  sendCommand({
                    type: "listen_together.seek",
                    room_slug: roomSlug,
                    positionMs: Number(event.currentTarget.value),
                  });
                }}
                className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
              />
              <span className="min-w-[34px] text-right text-[10px] text-rm-text-muted/75 tabular-nums">
                {formatListenTogetherDuration(durationMs)}
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            {onOpenQueue ? (
              <button
                type="button"
                onClick={onOpenQueue}
                className="inline-flex items-center gap-2 rounded-full border border-white/6 bg-rm-bg-hover/75 px-3 py-1.5 text-[11px] font-semibold text-rm-text-muted transition-colors hover:bg-rm-bg-active hover:text-rm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-md:h-8 max-md:w-8 max-md:justify-center max-md:gap-0 max-md:px-0"
                aria-label="Open listen together queue"
              >
                <ListMusic className="h-3.5 w-3.5" />
                <span className="max-md:hidden">
                  {queueCount > 0 ? `Queue ${queueCount}` : "Open queue"}
                </span>
              </button>
            ) : (
              <div className="text-[11px] text-rm-text-muted">
                {currentEntry.track.sourceLabel}
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1 max-md:gap-1.5">
              <button
                type="button"
                onClick={() => {
                  sendCommand({
                    type: "listen_together.pause",
                    room_slug: roomSlug,
                    paused: !isPaused,
                  });
                }}
                disabled={!canControl}
                className={iconButtonClass}
                aria-label={
                  isPaused ? "Resume shared playback" : "Pause shared playback"
                }
              >
                {isPaused ? (
                  <Play className="h-3.5 w-3.5" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  sendCommand({
                    type: "listen_together.skip",
                    room_slug: roomSlug,
                  });
                }}
                disabled={!canControl}
                className={iconButtonClass}
                aria-label="Skip current track"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("space-y-4", className)}>
        <div className="flex gap-4 sm:gap-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[22px] bg-rm-bg-elevated/60 shadow-[0_14px_32px_rgba(0,0,0,0.2)] ring-1 ring-white/10 sm:h-24 sm:w-24 sm:rounded-[26px]">
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
                    className="max-w-[320px] bg-rm-bg-floating text-rm-text-primary"
                  >
                    <p className="break-words text-sm font-semibold">
                      {currentEntry.track.title}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <div className="mt-1 truncate text-xs text-rm-text-muted sm:text-sm">
                  {subtitle}
                </div>
              </div>
              {queueCount > 0 && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold tabular-nums text-primary">
                  {queueCount} queued
                </span>
              )}
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-rm-text-muted">
              <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full bg-rm-bg-hover">
                {requesterAvatar}
              </div>
              <span className="truncate">{requesterLine}</span>
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
              sendCommand({
                type: "listen_together.seek",
                room_slug: roomSlug,
                positionMs: Number(event.currentTarget.value),
              });
            }}
            className="h-8 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between text-[11px] tabular-nums text-rm-text-muted">
            <span>{formatListenTogetherDuration(effectiveSeekValue)}</span>
            <span>{formatListenTogetherDuration(durationMs)}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-[18px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error.message}
          </div>
        )}

        <div className="flex items-center justify-center gap-2 sm:justify-start">
          <button
            type="button"
            onClick={() => {
              sendCommand({
                type: "listen_together.pause",
                room_slug: roomSlug,
                paused: !isPaused,
              });
            }}
            disabled={!canControl}
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-[0_8px_18px_color-mix(in_srgb,var(--primary)_25%,transparent)] transition-transform hover:bg-primary/90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50",
            )}
            aria-label={
              isPaused ? "Resume shared playback" : "Pause shared playback"
            }
          >
            {isPaused ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              sendCommand({
                type: "listen_together.skip",
                room_slug: roomSlug,
              });
            }}
            disabled={!canControl}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-rm-border bg-rm-bg-elevated/60 px-4 text-xs font-bold text-rm-text transition-transform hover:bg-rm-bg-active active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip
          </button>
          <button
            type="button"
            onClick={() => {
              sendCommand({
                type: "listen_together.remove",
                room_slug: roomSlug,
                entryId: currentEntry.entryId,
              });
            }}
            disabled={!canControl}
            className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10 text-destructive transition-transform hover:bg-destructive/15 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 sm:ml-2"
            aria-label="Remove current track"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex min-h-11 items-center gap-3 border-t border-rm-border pt-3">
          <Volume2 className="h-4 w-4 shrink-0 text-rm-text-muted" />
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
          <span className="min-w-9 text-right text-xs tabular-nums text-rm-text-muted">
            {Math.round(localVolume * 100)}%
          </span>
          <details className="relative shrink-0">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-rm-text-muted outline-none transition-colors hover:bg-rm-bg-hover hover:text-rm-text focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
              <ShieldCheck className="h-4 w-4" />
              <span className="sr-only">Audio options</span>
            </summary>
            <div className="absolute bottom-12 right-0 z-20 w-56 rounded-2xl border border-rm-border bg-rm-bg-floating p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-rm-text">Loudness</div>
                  <div className="text-[11px] text-rm-text-muted">
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
                    "relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    loudnessEnabled
                      ? "border-primary/50 bg-primary"
                      : "border-rm-border bg-rm-bg-hover",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                      loudnessEnabled ? "translate-x-4.5" : "translate-x-0",
                    )}
                  />
                </button>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-rm-bg-elevated/60 p-1">
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
                        "min-w-0 flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                        loudnessPreset === preset
                          ? "bg-rm-bg-active text-rm-text shadow-sm"
                          : "text-rm-text-muted hover:text-rm-text",
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

        <div className="flex items-center justify-between gap-3 text-[11px] text-rm-text-muted">
          <span className="truncate">{currentEntry.track.sourceLabel}</span>
          <button
            type="button"
            onClick={() => {
              sendCommand({
                type: "listen_together.clear",
                room_slug: roomSlug,
              });
            }}
            disabled={!canControl}
            className="shrink-0 rounded-full px-2 py-1 font-semibold transition-colors hover:bg-rm-bg-hover hover:text-rm-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear queue
          </button>
        </div>
      </div>
    </TooltipProvider>
  );
}
