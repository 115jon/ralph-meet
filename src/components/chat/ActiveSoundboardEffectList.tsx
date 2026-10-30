import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
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
import { useAppActive } from "@/hooks/useAppActive";
import { useUserResolution } from "@/hooks/useUserResolution";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { formatElapsed, Num } from "@/components/ui/num";
import { useEffect, useId, useRef, useState } from "react";

import { RangeSlider } from "./floating/RangeSlider";

interface EffectItemProps {
  playback: {
    playbackId: string;
    ownerId: string;
    serverKey: string;
    name: string;
    isLocal: boolean;
    paused: boolean;
    volume: number;
    /** Epoch ms it started; shows the running time when set. */
    startedAt?: number;
  };
  localUserId?: string | null;
  serverKey: string;
  sfu: SFUClient | null;
  variant: "default" | "compact" | "floating";
}

/**
 * How long a sound has played, in its own leaf: one tick a second aligned to
 * the second, none while it is paused or the app is inactive. Paused time
 * is left out.
 */
function SoundboardElapsed({
  startedAt,
  paused,
}: {
  startedAt: number;
  paused: boolean;
}) {
  const active = useAppActive();
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Date.now() - startedAt),
  );
  const pausedTotal = useRef(0);
  const pausedSince = useRef<number | null>(null);

  useEffect(() => {
    if (paused) {
      pausedSince.current ??= Date.now();
      return;
    }
    if (pausedSince.current !== null) {
      pausedTotal.current += Date.now() - pausedSince.current;
      pausedSince.current = null;
    }
    if (!active) return;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const value = Math.max(0, Date.now() - startedAt - pausedTotal.current);
      setElapsed(value);
      id = setTimeout(tick, 1000 - (value % 1000));
    };
    tick();
    return () => clearTimeout(id);
  }, [active, paused, startedAt]);

  return <Num className="shrink-0 text-ink-3">{formatElapsed(elapsed)}</Num>;
}

/**
 * One playing sound as a tracklist row: name, who played it, running time,
 * then pause (yours only) and stop. In the floating manager the per-sound
 * volume sits behind the row's expand button.
 */
export function SoundboardPlaybackRow({
  playback,
  localUserId,
  serverKey,
  sfu,
  variant,
}: EffectItemProps) {
  const authorInfo = useUserResolution(playback.ownerId);
  const isOwner = playback.ownerId === localUserId;
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeRegionId = useId();

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
  const percent = Math.round(playback.volume * 100);

  return (
    <div
      data-soundboard-row={playback.playbackId}
      className={cn(
        "rounded-md text-ink-1 transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1",
        variant === "compact" ? "px-1.5 py-1" : "px-2 py-1.5",
        volumeOpen && "bg-tint-1",
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex size-5 shrink-0 items-center justify-center bg-tint-3",
            avatarShape(authorInfo.avatarUrl && authorInfo.avatarDisplay),
          )}
        >
          {authorInfo.avatarUrl ? (
            <AvatarImage
              src={getAuthAssetUrl(authorInfo.avatarUrl)}
              alt=""
              display={authorInfo.avatarDisplay}
            />
          ) : (
            <span className="font-display text-[11px] leading-none font-extrabold text-ink-1">
              {getDisplayInitial({ name: authorInfo.displayName })}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <InlineEmojiText
            text={playback.name}
            className="truncate text-ui-sm font-medium text-ink-1"
          />
          <span className="truncate text-ui-xs text-ink-3">
            <InlineEmojiText text={authorInfo.displayName} />
          </span>
        </div>
        {playback.startedAt !== undefined ? (
          <SoundboardElapsed
            startedAt={playback.startedAt}
            paused={playback.paused}
          />
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5">
          {isOwner && (
            <IconButton
              icon={playback.paused ? "play" : "pause"}
              size={28}
              variant="muted"
              tooltip={playback.paused ? "Resume" : "Pause"}
              onClick={handleTogglePause}
            />
          )}
          <IconButton
            icon="stop"
            size={28}
            variant="destructive"
            tooltip="Stop"
            onClick={handleStop}
          />
          {variant === "floating" && (
            <IconButton
              icon={volumeOpen ? "chevronUp" : "chevronDown"}
              size={28}
              variant="muted"
              aria-label={`${volumeOpen ? "Hide" : "Show"} volume for ${playback.name}`}
              aria-expanded={volumeOpen}
              aria-controls={volumeRegionId}
              onClick={() => setVolumeOpen((open) => !open)}
            />
          )}
        </div>
      </div>
      {variant === "floating" && volumeOpen ? (
        <div
          id={volumeRegionId}
          className="flex items-center gap-2 pt-1.5 pb-0.5 pl-7.5"
        >
          <Icon
            name={percent === 0 ? "speakerOff" : "voiceChannel"}
            size="xs"
            className="shrink-0 text-ink-3"
          />
          <RangeSlider
            id={volumeControlId}
            aria-label={`Volume for ${playback.name}`}
            aria-valuetext={`${percent} percent`}
            value={percent}
            onValueChange={(value) => handleVolumeChange(value / 100)}
            className="flex-1"
          />
          <Num className="w-9 text-right text-ink-3">{percent}%</Num>
        </div>
      ) : null}
    </div>
  );
}
