import { AvatarImage } from "@/components/chat/AvatarImage";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import {
  pauseSoundboardPlayback,
  resumeSoundboardPlayback,
  setSoundboardPlaybackVolume,
  stopSoundboardPlayback,
  getSoundboardServerKey,
} from "@/lib/voice/soundboard";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { useUserResolution } from "@/hooks/useUserResolution";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ActiveSoundboardEffectListProps {
  serverId?: string | null;
  serverKey?: string;
  localUserId?: string | null;
  sfu: SFUClient | null;
  variant?: "default" | "compact" | "floating";
  className?: string;
}

export function ActiveSoundboardEffectList({
  serverId,
  serverKey: explicitServerKey,
  localUserId,
  sfu,
  variant = "default",
  className,
}: ActiveSoundboardEffectListProps) {
  const activePlaybacks = useVoiceSoundboardStore((s) => s.activePlaybacks);

  const serverKey = explicitServerKey ?? getSoundboardServerKey(serverId);

  const scopedPlaybacks = useMemo(() => {
    return Object.values(activePlaybacks)
      .filter(
        (playback) =>
          playback.serverKey === serverKey && playback.ownerId === localUserId,
      )
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [activePlaybacks, localUserId, serverKey]);

  if (scopedPlaybacks.length === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("space-y-2", className)}>
        {scopedPlaybacks.map((playback) => (
          <SoundboardPlaybackRow
            key={playback.playbackId}
            playback={playback}
            localUserId={localUserId}
            serverKey={serverKey}
            sfu={sfu}
            variant={variant}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

interface EffectItemProps {
  playback: {
    playbackId: string;
    ownerId: string;
    serverKey: string;
    name: string;
    isLocal: boolean;
    paused: boolean;
    volume: number;
  };
  localUserId?: string | null;
  serverKey: string;
  sfu: SFUClient | null;
  variant: "default" | "compact" | "floating";
}

export function SoundboardPlaybackRow({
  playback,
  localUserId,
  serverKey,
  sfu,
  variant,
}: EffectItemProps) {
  const authorInfo = useUserResolution(playback.ownerId);
  const isOwner = playback.ownerId === localUserId;

  const handleTogglePause = () => {
    if (playback.paused) {
      resumeSoundboardPlayback(playback.playbackId, serverKey);
    } else {
      pauseSoundboardPlayback(playback.playbackId, serverKey);
    }

    if (playback.playbackId === "local-preview") return;

    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.pause-set",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playback.playbackId,
      paused: !playback.paused,
    });
  };

  const handleStop = () => {
    stopSoundboardPlayback(playback.playbackId, serverKey);

    if (playback.playbackId === "local-preview") return;

    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.stop",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playback.playbackId,
    });
  };

  const handleVolumeChange = (volume: number) => {
    setSoundboardPlaybackVolume(playback.playbackId, volume, serverKey);

    if (playback.playbackId === "local-preview") return;

    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.volume-set",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playback.playbackId,
      volume,
    });
  };

  const volumeControlId = `soundboard-volume-${encodeURIComponent(
    `${serverKey}:${playback.playbackId}`,
  )}`;

  return (
    <div
      className={cn(
        "rounded-md border bg-rm-bg-hover text-rm-text border-rm-border/30",
        variant === "compact"
          ? "px-2 py-1.5"
          : variant === "floating"
            ? "border-rm-border/50 bg-rm-bg-surface/70 px-2.5 py-2"
            : "px-3 py-2",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          <div className="h-6 w-6 shrink-0 rounded-full bg-rm-bg-surface overflow-hidden flex items-center justify-center border border-rm-border">
            {authorInfo.avatarUrl ? (
              <AvatarImage
                src={getAuthAssetUrl(authorInfo.avatarUrl)}
                alt=""
                display={authorInfo.avatarDisplay}
              />
            ) : (
              <span className="text-[10px] text-rm-text-muted font-bold uppercase">
                {getDisplayInitial({ name: authorInfo.displayName })}
              </span>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-xs font-bold">{playback.name}</span>
            <span className="text-[10px] font-normal text-rm-text-muted truncate">
              {authorInfo.displayName}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isOwner && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  aria-label={playback.paused ? "Resume" : "Pause"}
                  className="flex items-center gap-1 rounded px-2 py-1 text-rm-text-muted hover:bg-rm-bg-active hover:text-rm-text"
                >
                  {playback.paused ? <Play size={12} /> : <Pause size={12} />}
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="border border-rm-border bg-rm-bg-floating text-rm-text shadow-lg"
              >
                {playback.paused ? "Resume" : "Pause"}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop"
                className="flex items-center gap-1 rounded px-2 py-1 text-rm-text-muted hover:bg-red-500/20 hover:text-red-400"
              >
                <Square size={11} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="border border-rm-border bg-rm-bg-floating text-rm-text shadow-lg"
            >
              Stop
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {variant === "floating" && (
        <div className="mt-2 flex items-center gap-2 pl-8">
          <Volume2 className="h-3 w-3 shrink-0 text-rm-text-muted" />
          <label className="sr-only" htmlFor={volumeControlId}>
            Volume for {playback.name}
          </label>
          <input
            id={volumeControlId}
            type="range"
            min={0}
            max={100}
            value={Math.round(playback.volume * 100)}
            aria-valuetext={`${Math.round(playback.volume * 100)} percent`}
            onChange={(event) =>
              handleVolumeChange(Number(event.currentTarget.value) / 100)
            }
            className="h-4 min-w-0 flex-1 cursor-pointer accent-primary"
          />
          <span className="w-8 text-right text-[10px] tabular-nums text-rm-text-muted">
            {Math.round(playback.volume * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
