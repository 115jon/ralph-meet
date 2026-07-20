import { AvatarImage } from "@/components/chat/AvatarImage";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import {
  pauseSoundboardPlayback,
  resumeSoundboardPlayback,
  stopSoundboardPlayback,
  getSoundboardServerKey,
} from "@/lib/voice/soundboard";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { useUserResolution } from "@/hooks/useUserResolution";
import { Pause, Play, Square } from "lucide-react";
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
  variant?: "default" | "compact";
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
        {variant === "compact" && (
          <div className="text-[10px] font-normal text-rm-text-muted/50 mb-1">
            {scopedPlaybacks.length} active
          </div>
        )}
        {scopedPlaybacks.map((playback) => (
          <EffectItem
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
  };
  localUserId?: string | null;
  serverKey: string;
  sfu: SFUClient | null;
  variant: "default" | "compact";
}

function EffectItem({
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
      resumeSoundboardPlayback(playback.playbackId);
    } else {
      pauseSoundboardPlayback(playback.playbackId);
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
    stopSoundboardPlayback(playback.playbackId);

    if (playback.playbackId === "local-preview") return;

    sfu?.voiceGW.sendAppEvent({
      type: "soundboard.stop",
      server_key: serverKey,
      user_id: localUserId,
      playback_id: playback.playbackId,
    });
  };

  return (
    <div
      className={cn(
        "rounded-md border bg-rm-bg-hover text-rm-text border-rm-border/30",
        variant === "compact" ? "px-2 py-1.5" : "px-3 py-2",
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
              <TooltipContent side="top">
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
            <TooltipContent side="top">Stop</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
