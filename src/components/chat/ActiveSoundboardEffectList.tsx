import { AvatarImage } from "@/components/chat/AvatarImage";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { cn } from "@/lib/utils";
import {
  pauseSoundboardPlayback,
  resumeSoundboardPlayback,
  setSoundboardPlaybackVolume,
  stopSoundboardPlayback,
} from "@/lib/voice/soundboard";
import { useUserResolution } from "@/hooks/useUserResolution";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";

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
              <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                {getDisplayInitial({ name: authorInfo.displayName })}
              </span>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <InlineEmojiText
              text={playback.name}
              className="truncate text-ui-xs font-semibold"
            />
            <span className="text-ui-2xs font-normal text-rm-text-muted truncate">
              <InlineEmojiText text={authorInfo.displayName} />
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isOwner && (
            <IconButton
              icon={playback.paused ? "play" : "pause"}
              size="xs"
              variant="muted"
              tooltip={playback.paused ? "Resume" : "Pause"}
              onClick={handleTogglePause}
            />
          )}
          <IconButton
            icon="stop"
            size="xs"
            variant="destructive"
            tooltip="Stop"
            onClick={handleStop}
          />
        </div>
      </div>
      {variant === "floating" && (
        <div className="mt-2 flex items-center gap-2 pl-8">
          <Icon
            name="voiceChannel"
            size="xs"
            className="shrink-0 text-rm-text-muted"
          />
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
          <span className="w-8 text-right text-ui-2xs tabular-nums text-rm-text-muted">
            {Math.round(playback.volume * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
